// Testable cache/decode/persistence lifecycle. The coordinator owns attempt identity.
import type {
  AstraLibraryData,
  AstraLibraryScanner,
  NativeTrackLoudness,
  TrackAnalysis,
} from '../../modules/astra-library-scanner/index';
import { hasUsableReplayGain, type LoudnessFacts, type NormalizationSettings } from './normalization.ts';
import type { CacheInvalidationGate } from '../lib/cacheInvalidation.ts';
import type { AnalysisAttempt } from './analysisCoordinator.ts';

export const WAVEFORM_BINS = 512;

/** Map a loudness DB row (or a miss) to the resolver's facts shape. */
export function factsFromRow(row: NativeTrackLoudness | null): LoudnessFacts {
  return {
    loudnessLufs: row?.loudness_lufs ?? null,
    samplePeak: row?.sample_peak ?? null,
    replayGainTrackDb: row?.replay_gain_track_db ?? null,
    replayGainAlbumDb: row?.replay_gain_album_db ?? null,
    replayGainTrackPeak: row?.replay_gain_track_peak ?? null,
    replayGainAlbumPeak: row?.replay_gain_album_peak ?? null,
  };
}

export interface TrackAnalysisResult {
  cancelled?: boolean;
  /** Normalized [0,1] peaks, or null when unavailable / not requested and uncached. */
  peaks: Float32Array | null;
  facts: LoudnessFacts;
}

export interface AnalysisJsTiming {
  cacheLookupMs: number;
  replayGainMs: number;
  preparationMs: number;
  persistenceMs: number;
  endToEndMs: number;
  waveformCacheHit: boolean;
  loudnessCacheHit: boolean;
}

export interface AnalysisDependencies {
  data: Pick<typeof AstraLibraryData, 'getTrackLoudness' | 'getWaveform' | 'getTrack' | 'setTrackReplayGain' | 'setTrackLoudness' | 'putWaveform'>;
  scanner: Pick<typeof AstraLibraryScanner, 'readReplayGain' | 'analyzeTrack' | 'cancelAnalysis'>;
  getSettings: () => NormalizationSettings;
  cacheGate: CacheInvalidationGate;
  recordTiming: (path: string, analysis: TrackAnalysis, attempt: AnalysisAttempt, timing: AnalysisJsTiming) => void;
}

export const cancelledAnalysisResult = (): TrackAnalysisResult => ({
  peaks: null,
  facts: factsFromRow(null),
  cancelled: true,
});

export function createAnalysisRunner(deps: AnalysisDependencies): (attempt: AnalysisAttempt) => Promise<TrackAnalysisResult> {
  return async function run(attempt: AnalysisAttempt): Promise<TrackAnalysisResult> {
    const path = attempt.path;
    const startedAt = Date.now();
    const generation = deps.cacheGate.capture();
    const isCurrent = () => !attempt.signal.aborted && deps.cacheGate.isCurrent(generation);
    if (!isCurrent()) return cancelledAnalysisResult();

    const lookupStartedAt = Date.now();
    const [row, cachedPeaks] = await Promise.all([
      deps.data.getTrackLoudness([path])
        .then((rows) => rows[0] ?? null)
        .catch(() => null),
      deps.data.getWaveform(path).catch(() => null),
    ]);
    const cacheLookupMs = Date.now() - lookupStartedAt;

    let facts = factsFromRow(row);
    let peaks = cachedPeaks && cachedPeaks.length > 0 ? Float32Array.from(cachedPeaks) : null;
    const waveformCacheHit = peaks !== null;
    const loudnessCacheHit = facts.loudnessLufs !== null;
    let replayGainMs = 0;
    const settings = deps.getSettings();

    // ReplayGain tags: container-only, no decode. Decoupled from loudness so a track measured
    // before ReplayGain was enabled still picks up its tags; rg_scanned stays unset on failure
    // so it retries next touch.
    if (isCurrent() && settings.enabled && settings.replayGainEnabled && (!row || row.rg_scanned !== 1)) {
      const replayGainStartedAt = Date.now();
      try {
        const rg = await deps.scanner.readReplayGain(path);
        await deps.data.setTrackReplayGain(
          path,
          rg.trackGainDb,
          rg.albumGainDb,
          rg.trackPeak,
          rg.albumPeak
        ).catch(() => {});
        facts = {
          ...facts,
          replayGainTrackDb: rg.trackGainDb,
          replayGainAlbumDb: rg.albumGainDb,
          replayGainTrackPeak: rg.trackPeak,
          replayGainAlbumPeak: rg.albumPeak,
        };
      } catch {
        /* tag read failed — fall through to a loudness measure */
      } finally {
        replayGainMs = Date.now() - replayGainStartedAt;
      }
    }

    // Loudness only needs measuring when it's unknown AND ReplayGain can't cover the track.
    const needLoudness =
      settings.enabled && facts.loudnessLufs == null && !hasUsableReplayGain(facts, settings);
    attempt.acknowledgeRequirements();
    const needPeaks = attempt.requirements.peaks && !peaks;
    if (!needLoudness && !needPeaks) return { peaks, facts };
    // Skipped past while we were reading the DB — don't start the decode at all.
    if (!isCurrent()) return cancelledAnalysisResult();

    // Normally supplied by the player/queue; on-demand callers can use the catalog hint.
    let durationMs = attempt.requirements.durationMs ?? 0;
    if (durationMs <= 0) {
      const track = await deps.data.getTrack<{ duration: number }>(path).catch(() => null);
      durationMs = (track?.duration ?? 0) * 1000;
    }
    if (!isCurrent()) return cancelledAnalysisResult();
    const preparationMs = Date.now() - startedAt;
    const abortNative = () => { void deps.scanner.cancelAnalysis(attempt.id).catch(() => {}); };
    attempt.signal.addEventListener('abort', abortNative, { once: true });
    let analysis: TrackAnalysis;
    try {
      analysis = await deps.scanner.analyzeTrack(path, WAVEFORM_BINS, needLoudness, attempt.id, durationMs);
    } catch {
      return { peaks, facts };
    } finally {
      attempt.signal.removeEventListener('abort', abortNative);
    }
    // Skipped past / timed out: peaks are truncated and loudness is partial. Cache neither.
    const validPeaks = analysis.peaks.length === WAVEFORM_BINS &&
      analysis.peaks.every((peak) => Number.isFinite(peak) && peak >= 0 && peak <= 1);
    if (analysis.cancelled || !analysis.completed || !validPeaks || !isCurrent()) {
      deps.recordTiming(path, analysis, attempt, {
        cacheLookupMs,
        replayGainMs,
        preparationMs,
        persistenceMs: 0,
        endToEndMs: Date.now() - startedAt,
        waveformCacheHit,
        loudnessCacheHit,
      });
      return { peaks, facts, cancelled: analysis.cancelled };
    }

    const persistenceStartedAt = Date.now();
    const completedPeaks = Float32Array.from(analysis.peaks);
    peaks = completedPeaks;
    await deps.cacheGate.enqueue(async () => {
      if (isCurrent()) await deps.data.putWaveform(path, Array.from(completedPeaks));
    }).catch(() => {
      /* cache write failure is non-fatal */
    });
    if (needLoudness && isCurrent()) {
      await deps.cacheGate.enqueue(async () => {
        if (isCurrent()) await deps.data.setTrackLoudness(path, analysis.lufs, analysis.peak);
      }).catch(() => {});
      facts = { ...facts, loudnessLufs: analysis.lufs, samplePeak: analysis.peak };
    }
    deps.recordTiming(path, analysis, attempt, {
      cacheLookupMs,
      replayGainMs,
      preparationMs,
      persistenceMs: Date.now() - persistenceStartedAt,
      endToEndMs: Date.now() - startedAt,
      waveformCacheHit,
      loudnessCacheHit,
    });
    return { peaks, facts };
  };
}

// Per-track analysis facts: waveform peaks + ReplayGain tags + measured integrated LUFS /
// sample peak.
//
// Peaks and loudness come from ONE native decode pass (analyzeTrack). Both need every
// sample, so running them as separate whole-file decodes meant decoding each track twice —
// and the two decodes then competed for the same native concurrency permits, which is why
// the waveform used to arrive so late. Peaks fall out of the pass regardless, so we persist
// them even when loudness was the only reason we decoded.
//
// ensureTrackAnalysis is the single deduped entry point. It reads what's already cached,
// decodes only what's missing, and stores both halves. ReplayGain tags are read first
// (container-only, no decode), so a fully tagged library still normalizes without decoding.

import {
  AstraLibraryData,
  AstraLibraryScanner,
  type NativeTrackLoudness,
  type TrackAnalysis,
} from '../../modules/astra-library-scanner';
import { hasUsableReplayGain, type LoudnessFacts } from '@/audio/normalization';
import { useAudioSettingsStore } from '@/stores/audioSettingsStore';
import { CacheInvalidationGate } from '@/lib/cacheInvalidation';

/** Stored waveform resolution. Downsampled to the bar count at render time. */
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
  /** Normalized [0,1] peaks, or null when unavailable / not requested and uncached. */
  peaks: Float32Array | null;
  facts: LoudnessFacts;
}

export interface EnsureAnalysisOptions {
  /**
   * Decode for waveform peaks when they're missing. Pass false from headless paths
   * (Android Auto / Bluetooth with no UI) that only need loudness — peaks are still
   * persisted if a loudness decode happens to run, since they come out free.
   */
  peaks?: boolean;
}

interface InflightRun {
  promise: Promise<TrackAnalysisResult>;
  wantPeaks: boolean;
}

const inflight = new Map<string, InflightRun>();
// Paths cancelled while their run was still in its DB-read phase. The native cancel flag
// only exists once analyzeTrack has been called, so without this a cancel landing in that
// window would be silently lost and the decode would run to completion anyway.
const cancelledPaths = new Set<string>();
const cacheGate = new CacheInvalidationGate();

/**
 * Analysis facts for a track, decoding at most once and only for what's actually missing
 * (deduped by path). Cheap when already analyzed — two DB reads and no decode.
 */
export function ensureTrackAnalysis(
  path: string,
  options: EnsureAnalysisOptions = {}
): Promise<TrackAnalysisResult> {
  const wantPeaks = options.peaks !== false;
  const existing = inflight.get(path);
  // A run that already covers what we need — join it.
  if (existing && (existing.wantPeaks || !wantPeaks)) return existing.promise;
  // A loudness-only run is going and we need peaks: let it finish (so we don't decode the
  // same file twice concurrently), then fill in the peaks.
  if (existing) return existing.promise.then(() => start(path, wantPeaks));
  return start(path, wantPeaks);
}

function start(path: string, wantPeaks: boolean): Promise<TrackAnalysisResult> {
  const existing = inflight.get(path);
  if (existing?.wantPeaks) return existing.promise;
  const promise = run(path, wantPeaks).finally(() => {
    if (inflight.get(path)?.promise === promise) {
      inflight.delete(path);
      cancelledPaths.delete(path);
    }
  });
  inflight.set(path, { promise, wantPeaks });
  return promise;
}

async function run(path: string, wantPeaks: boolean): Promise<TrackAnalysisResult> {
  const startedAt = Date.now();
  const generation = cacheGate.capture();

  const lookupStartedAt = Date.now();
  const [row, cachedPeaks] = await Promise.all([
    AstraLibraryData.getTrackLoudness([path])
      .then((rows) => rows[0] ?? null)
      .catch(() => null),
    AstraLibraryData.getWaveform(path).catch(() => null),
  ]);
  const cacheLookupMs = Date.now() - lookupStartedAt;

  let facts = factsFromRow(row);
  let peaks = cachedPeaks && cachedPeaks.length > 0 ? Float32Array.from(cachedPeaks) : null;
  const waveformCacheHit = peaks !== null;
  const loudnessCacheHit = facts.loudnessLufs !== null;
  let replayGainMs = 0;
  const settings = useAudioSettingsStore.getState().asNormalizationSettings();

  // ReplayGain tags: container-only, no decode. Decoupled from loudness so a track measured
  // before ReplayGain was enabled still picks up its tags; rg_scanned stays unset on failure
  // so it retries next touch.
  if (settings.enabled && (!row || row.rg_scanned !== 1)) {
    const replayGainStartedAt = Date.now();
    try {
      const rg = await AstraLibraryScanner.readReplayGain(path);
      await AstraLibraryData.setTrackReplayGain(
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
  const needPeaks = wantPeaks && !peaks;
  if (!needLoudness && !needPeaks) return { peaks, facts };
  // Skipped past while we were reading the DB — don't start the decode at all.
  if (cancelledPaths.has(path)) return { peaks, facts };

  const preparationMs = Date.now() - startedAt;
  let analysis: TrackAnalysis;
  try {
    analysis = await AstraLibraryScanner.analyzeTrack(path, WAVEFORM_BINS, needLoudness);
  } catch {
    return { peaks, facts };
  }
  // Skipped past / timed out: peaks are truncated and loudness is partial. Cache neither.
  if (analysis.cancelled) {
    recordTiming(path, analysis, {
      cacheLookupMs,
      replayGainMs,
      preparationMs,
      persistenceMs: 0,
      endToEndMs: Date.now() - startedAt,
      waveformCacheHit,
      loudnessCacheHit,
    });
    return { peaks, facts };
  }

  const persistenceStartedAt = Date.now();
  if (analysis.peaks && analysis.peaks.length > 0) {
    peaks = Float32Array.from(analysis.peaks);
    await persistPeaks(path, peaks, generation);
  }
  if (needLoudness) {
    await AstraLibraryData.setTrackLoudness(path, analysis.lufs, analysis.peak).catch(() => {});
    facts = { ...facts, loudnessLufs: analysis.lufs, samplePeak: analysis.peak };
  }
  recordTiming(path, analysis, {
    cacheLookupMs,
    replayGainMs,
    preparationMs,
    persistenceMs: Date.now() - persistenceStartedAt,
    endToEndMs: Date.now() - startedAt,
    waveformCacheHit,
    loudnessCacheHit,
  });
  return { peaks, facts };
}

async function persistPeaks(
  path: string,
  peaks: Float32Array,
  generation: number
): Promise<void> {
  await cacheGate
    .enqueue(async () => {
      if (!cacheGate.isCurrent(generation)) return;
      await AstraLibraryData.putWaveform(path, Array.from(peaks));
    })
    .catch(() => {
      /* cache write failure is non-fatal */
    });
}

/**
 * Loudness facts only — the normalization path's entry point. Does not decode purely to
 * fill in a missing waveform, but keeps the peaks if a loudness decode produces them.
 */
export async function ensureTrackLoudness(path: string): Promise<LoudnessFacts> {
  const { facts } = await ensureTrackAnalysis(path, { peaks: false });
  return facts;
}

/**
 * Stop an in-flight analysis for a track we've skipped past, so it stops burning CPU and
 * frees a native decode permit for the track the user is actually on.
 */
export function cancelTrackAnalysis(path: string): void {
  if (!inflight.has(path)) return;
  cancelledPaths.add(path);
  void AstraLibraryScanner.cancelAnalysis(path).catch(() => {});
}

/** Paths with an analysis currently running or queued. */
export function activeAnalysisPaths(): string[] {
  return Array.from(inflight.keys());
}

/** Drops cached waveform rows and stops in-flight decodes from writing them back. */
export async function clearWaveformCache(): Promise<void> {
  inflight.clear();
  cancelledPaths.clear();
  await cacheGate.invalidate(async () => {
    await AstraLibraryData.clearWaveforms();
  });
}

// ---------------------------------------------------------------------------
// Timing instrumentation
// ---------------------------------------------------------------------------

export interface AnalysisTiming {
  path: string;
  kind: 'analysis';
  decodeMs: number;
  durationMs: number | null;
  /** durationMs / decodeMs — how many times faster than realtime the decode ran. */
  realtimeFactor: number | null;
  decoderName: string | null;
  mime: string | null;
  withLoudness: boolean;
  cancelled: boolean;
  cacheLookupMs: number | null;
  replayGainMs: number | null;
  preparationMs: number | null;
  nativeQueueWaitMs: number | null;
  setupMs: number | null;
  firstPcmMs: number | null;
  firstProgressMs: number | null;
  firstProgressEndToEndMs: number | null;
  decodeToEosMs: number | null;
  finalizeMs: number | null;
  persistenceMs: number | null;
  cleanupMs: number | null;
  endToEndMs: number;
  waveformCacheHit: boolean | null;
  loudnessCacheHit: boolean | null;
  at: number;
}

interface AnalysisJsTiming {
  cacheLookupMs: number;
  replayGainMs: number;
  preparationMs: number;
  persistenceMs: number;
  endToEndMs: number;
  waveformCacheHit: boolean;
  loudnessCacheHit: boolean;
}

const MAX_TIMINGS = 20;
const recentTimings: AnalysisTiming[] = [];

function push(timing: AnalysisTiming): void {
  recentTimings.unshift(timing);
  if (recentTimings.length > MAX_TIMINGS) recentTimings.length = MAX_TIMINGS;
}

function recordTiming(path: string, analysis: TrackAnalysis, js: AnalysisJsTiming): void {
  if (analysis.decodeMs == null && analysis.endToEndMs == null) return;
  const nativeQueueWaitMs = analysis.queueWaitMs ?? null;
  const firstProgressMs = analysis.firstProgressMs ?? null;
  push({
    path,
    kind: 'analysis',
    decodeMs: analysis.decodeMs ?? analysis.endToEndMs ?? 0,
    durationMs: analysis.durationMs,
    realtimeFactor: analysis.realtimeFactor,
    decoderName: analysis.decoderName,
    mime: analysis.mime,
    withLoudness: analysis.withLoudness,
    cancelled: analysis.cancelled,
    cacheLookupMs: js.cacheLookupMs,
    replayGainMs: js.replayGainMs,
    preparationMs: js.preparationMs,
    nativeQueueWaitMs,
    setupMs: analysis.setupMs,
    firstPcmMs: analysis.firstPcmMs,
    firstProgressMs,
    firstProgressEndToEndMs:
      firstProgressMs == null
        ? null
        : js.preparationMs + (nativeQueueWaitMs ?? 0) + firstProgressMs,
    decodeToEosMs: analysis.decodeToEosMs,
    finalizeMs: analysis.finalizeMs,
    persistenceMs: js.persistenceMs,
    cleanupMs: analysis.cleanupMs,
    endToEndMs: js.endToEndMs,
    waveformCacheHit: js.waveformCacheHit,
    loudnessCacheHit: js.loudnessCacheHit,
    at: Date.now(),
  });
  if (__DEV__ && !analysis.cancelled) {
    const rt = analysis.realtimeFactor;
    const decodeMs = analysis.decodeMs ?? analysis.endToEndMs ?? 0;
    console.log(
      `[analysis] ${analysis.mime ?? '?'} ${decodeMs.toFixed(0)}ms` +
        `${rt ? ` (${rt.toFixed(0)}x realtime)` : ''}` +
        ` via ${analysis.decoderName ?? '?'}${analysis.withLoudness ? ' +loudness' : ''}`
    );
  }
}

/** Most recent decodes, newest first — surfaced in Settings → Troubleshooting. */
export function getRecentAnalysisTimings(): readonly AnalysisTiming[] {
  return recentTimings;
}

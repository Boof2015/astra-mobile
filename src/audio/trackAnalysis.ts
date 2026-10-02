// Shared entry point for waveform and loudness analysis. The coordinator deduplicates
// requests and prioritizes the current track; the runner owns cache lookup, ReplayGain
// metadata, a combined decode pass, and persistence of completed results.

import {
  AstraLibraryData,
  AstraLibraryScanner,
  type TrackAnalysis,
} from '../../modules/astra-library-scanner';
import type { LoudnessFacts } from '@/audio/normalization';
import { useAudioSettingsStore } from '@/stores/audioSettingsStore';
import { CacheInvalidationGate } from '@/lib/cacheInvalidation';
import { AnalysisCoordinator, type AnalysisAttempt, type AnalysisPriority } from './analysisCoordinator';

import {
  createAnalysisRunner,
  cancelledAnalysisResult,
  type TrackAnalysisResult,
  type AnalysisJsTiming,
} from './trackAnalysisRunner';

export { WAVEFORM_BINS, factsFromRow } from './trackAnalysisRunner';
export type { TrackAnalysisResult } from './trackAnalysisRunner';

export interface EnsureAnalysisOptions {
  /**
   * Decode for waveform peaks when they're missing. Pass false from headless paths
   * (Android Auto / Bluetooth with no UI) that only need loudness — peaks are still
   * persisted if a loudness decode happens to run, since they come out free.
   */
  peaks?: boolean;
  priority?: AnalysisPriority;
  durationMs?: number;
}

const cacheGate = new CacheInvalidationGate();
const run = createAnalysisRunner({
  data: AstraLibraryData, scanner: AstraLibraryScanner, cacheGate,
  getSettings: () => useAudioSettingsStore.getState().asNormalizationSettings(),
  recordTiming,
});
const coordinator = new AnalysisCoordinator<TrackAnalysisResult>(run, cancelledAnalysisResult);

/** Cache-first, deduplicated across UI, queue prefetch, and headless playback. */
export function ensureTrackAnalysis(
  path: string,
  options: EnsureAnalysisOptions = {},
): Promise<TrackAnalysisResult> {
  if (!path.startsWith('file://') && !path.startsWith('content://')) {
    return Promise.resolve(cancelledAnalysisResult());
  }
  return coordinator.request(path, {
    peaks: options.peaks !== false,
    priority: options.priority ?? 'interactive',
    durationMs: options.durationMs,
  });
}

export function setCurrentAnalysisPath(path: string | null): void {
  coordinator.setCurrentPath(path);
}

export function reconcileAnalysisPrefetch(paths: readonly string[]): void {
  coordinator.reconcilePrefetch(paths);
}

export function isCurrentAnalysisAttempt(path: string, attemptId: string): boolean {
  return coordinator.isCurrentAttempt(path, attemptId);
}

export function isCurrentAnalysisPath(path: string): boolean {
  return coordinator.isCurrentPath(path);
}

/**
 * Loudness facts only — the normalization path's entry point. Does not decode purely to
 * fill in a missing waveform, but keeps the peaks if a loudness decode produces them.
 */
export async function ensureTrackLoudness(path: string): Promise<LoudnessFacts> {
  const { facts, cancelled } = await ensureTrackAnalysis(path, { peaks: false });
  if (cancelled) throw new Error('Track analysis cancelled');
  return facts;
}

/**
 * Stop an in-flight analysis for a track we've skipped past, so it stops burning CPU and
 * frees a native decode permit for the track the user is actually on.
 */
export function cancelTrackAnalysis(path: string): void {
  coordinator.cancel(path);
}

export function activeAnalysisPaths(): string[] {
  return coordinator.paths();
}

/** Cancel attempts without releasing their lanes until native teardown has drained. */
export async function clearWaveformCache(): Promise<void> {
  coordinator.cancelAll();
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
  schedulerWaitMs: number;
  promoted: boolean;
  decoderRoute: string;
  fallbackReason: string | null;
  completed: boolean;
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

const MAX_TIMINGS = 20;
const recentTimings: AnalysisTiming[] = [];

function push(timing: AnalysisTiming): void {
  recentTimings.unshift(timing);
  if (recentTimings.length > MAX_TIMINGS) recentTimings.length = MAX_TIMINGS;
}

function recordTiming(path: string, analysis: TrackAnalysis, attempt: AnalysisAttempt, js: AnalysisJsTiming): void {
  if (analysis.decodeMs == null && analysis.endToEndMs == null) return;
  const nativeQueueWaitMs = analysis.queueWaitMs ?? null;
  const firstProgressMs = analysis.firstProgressMs ?? null;
  push({
    path,
    kind: 'analysis',
    schedulerWaitMs: attempt.schedulerWaitMs,
    promoted: attempt.promoted,
    decoderRoute: analysis.decoderRoute,
    fallbackReason: analysis.fallbackReason,
    completed: analysis.completed,
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
        : attempt.schedulerWaitMs + js.preparationMs + (nativeQueueWaitMs ?? 0) + firstProgressMs,
    decodeToEosMs: analysis.decodeToEosMs,
    finalizeMs: analysis.finalizeMs,
    persistenceMs: js.persistenceMs,
    cleanupMs: analysis.cleanupMs,
    endToEndMs: attempt.schedulerWaitMs + js.endToEndMs,
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

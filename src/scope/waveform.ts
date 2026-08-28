// Waveform peaks for the seek bar: cache-first, then the accurate decode. The accurate pass
// lives in trackAnalysis (it shares one decode with loudness) and streams partial results
// back through onWaveformProgress, so the bar fills in left-to-right instead of snapping in
// when the whole file is done.

import { AstraLibraryData, AstraLibraryScanner } from '../../modules/astra-library-scanner';
import {
  WAVEFORM_BINS,
  clearWaveformCache,
  ensureTrackAnalysis,
} from '@/audio/trackAnalysis';

export { WAVEFORM_BINS };
export { downsampleWaveform, normalizeProgressiveWaveform } from '@/scope/waveformMath';

export function getWaveform(trackPath: string): Promise<Float32Array | null> {
  if (!isLocalWaveformPath(trackPath)) return Promise.resolve(null);
  return loadWaveform(trackPath);
}

async function loadWaveform(trackPath: string): Promise<Float32Array | null> {
  const cached = await AstraLibraryData.getWaveform(trackPath).catch(() => null);
  if (cached && cached.length > 0) return Float32Array.from(cached);

  // Shares one decode pass with loudness, and may already be running from the queue
  // prefetch — in which case this just joins it. Failures fall back to flat bars.
  try {
    const { peaks } = await ensureTrackAnalysis(trackPath);
    return peaks;
  } catch {
    return null;
  }
}

/** Deletes waveform rows and prevents decodes already in flight from writing them back. */
export async function clearAllWaveformCache(): Promise<void> {
  await clearWaveformCache();
}

// ---------------------------------------------------------------------------
// Progressive decode updates
// ---------------------------------------------------------------------------

export type WaveformProgressListener = (partial: {
  /** Raw (un-normalized) RMS for the bins decoded so far. */
  peaks: Float32Array;
  filledBins: number;
  totalBins: number;
}) => void;

const progressListeners = new Map<string, Set<WaveformProgressListener>>();
let nativeProgressSub: { remove(): void } | null = null;

/**
 * Listen for partial waveforms while a track decodes. Independent of who started the
 * decode, so the seek bar still fills progressively when the queue prefetch kicked it off.
 * Returns an unsubscribe function.
 */
export function subscribeWaveformProgress(
  trackPath: string,
  listener: WaveformProgressListener
): () => void {
  if (!nativeProgressSub) {
    nativeProgressSub = AstraLibraryScanner.addListener('onWaveformProgress', (event) => {
      const listeners = progressListeners.get(event.uri);
      if (!listeners || listeners.size === 0) return;
      const partial = {
        peaks: Float32Array.from(event.peaks),
        filledBins: event.filledBins,
        totalBins: event.totalBins,
      };
      for (const cb of listeners) cb(partial);
    });
  }

  let listeners = progressListeners.get(trackPath);
  if (!listeners) {
    listeners = new Set();
    progressListeners.set(trackPath, listeners);
  }
  listeners.add(listener);

  return () => {
    const current = progressListeners.get(trackPath);
    if (!current) return;
    current.delete(listener);
    if (current.size === 0) progressListeners.delete(trackPath);
  };
}

export function isLocalWaveformPath(trackPath: string): boolean {
  return trackPath.startsWith('content://') || trackPath.startsWith('file://');
}

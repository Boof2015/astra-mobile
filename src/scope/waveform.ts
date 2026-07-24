// Waveform peaks for the seek bar: cache-first, preview-on-miss, accurate
// decode-on-miss, store. The heavy native decode (extractWaveform) still runs
// once per track and persists; extractWaveformPreview gives uncached local
// tracks a fast first paint.

import { AstraLibraryData, AstraLibraryScanner } from '../../modules/astra-library-scanner';
import { CacheInvalidationGate } from '@/lib/cacheInvalidation';

export const WAVEFORM_BINS = 512;
export const WAVEFORM_PREVIEW_BINS = 96;

export interface WaveformLoadOptions {
  onPreview?: (peaks: Float32Array) => void;
}

// Dedupe concurrent requests for the same track (e.g. mini-player + now-playing).
const inflight = new Map<string, Promise<Float32Array | null>>();
const previewInflight = new Map<string, Promise<Float32Array | null>>();
const cacheGate = new CacheInvalidationGate();

export function getWaveform(
  trackPath: string,
  options: WaveformLoadOptions = {}
): Promise<Float32Array | null> {
  if (!isLocalWaveformPath(trackPath)) return Promise.resolve(null);
  return loadWaveform(trackPath, options);
}

async function loadWaveform(
  trackPath: string,
  options: WaveformLoadOptions
): Promise<Float32Array | null> {
  const cached = await AstraLibraryData.getWaveform(trackPath);
  if (cached && cached.length > 0) return Float32Array.from(cached);

  if (options.onPreview) {
    void getWaveformPreview(trackPath).then((preview) => {
      if (preview && preview.length > 0) options.onPreview?.(preview);
    });
  }

  const existing = inflight.get(trackPath);
  if (existing) return existing;
  const generation = cacheGate.capture();
  const task = decodeAccurateWaveform(trackPath, generation).finally(() => {
    if (inflight.get(trackPath) === task) inflight.delete(trackPath);
  });
  inflight.set(trackPath, task);
  return task;
}

async function decodeAccurateWaveform(trackPath: string, generation: number): Promise<Float32Array | null> {
  let raw: number[];
  try {
    raw = await AstraLibraryScanner.extractWaveform(trackPath, WAVEFORM_BINS);
  } catch {
    return null;
  }
  if (!raw || raw.length === 0) return null;

  const peaks = Float32Array.from(raw);
  await cacheGate.enqueue(async () => {
    if (!cacheGate.isCurrent(generation)) return;
    if (!cacheGate.isCurrent(generation)) return;
    await AstraLibraryData.putWaveform(trackPath, Array.from(peaks));
  }).catch(() => {
    /* cache write failure is non-fatal */
  });
  return peaks;
}

/** Deletes waveform rows and prevents decodes already in flight from writing them back. */
export async function clearAllWaveformCache(): Promise<void> {
  inflight.clear();
  previewInflight.clear();
  await cacheGate.invalidate(async () => {
    await AstraLibraryData.clearWaveforms();
  });
}

function getWaveformPreview(trackPath: string): Promise<Float32Array | null> {
  const existing = previewInflight.get(trackPath);
  if (existing) return existing;
  const task = decodePreviewWaveform(trackPath).finally(() => {
    if (previewInflight.get(trackPath) === task) previewInflight.delete(trackPath);
  });
  previewInflight.set(trackPath, task);
  return task;
}

async function decodePreviewWaveform(trackPath: string): Promise<Float32Array | null> {
  let raw: number[];
  try {
    raw = await AstraLibraryScanner.extractWaveformPreview(trackPath, WAVEFORM_PREVIEW_BINS);
  } catch {
    return null;
  }
  if (!raw || raw.length === 0) return null;
  return Float32Array.from(raw);
}

function isLocalWaveformPath(trackPath: string): boolean {
  return trackPath.startsWith('content://') || trackPath.startsWith('file://');
}

/**
 * Downsample high-res peaks to `barCount` bars with a power curve and two
 * smoothing passes. Ported verbatim from desktop waveformExtractor.ts so the
 * mobile seek bar matches the desktop look.
 */
export function downsampleWaveform(source: Float32Array, barCount: number): Float32Array {
  if (source.length === 0 || barCount <= 0) return new Float32Array(0);
  const binsPerBar = source.length / barCount;
  const peaks = new Float32Array(barCount);

  for (let i = 0; i < barCount; i++) {
    const start = Math.floor(i * binsPerBar);
    const end = Math.max(start + 1, Math.floor((i + 1) * binsPerBar));
    let sum = 0;
    for (let j = start; j < end; j++) sum += source[j];
    peaks[i] = sum / (end - start);
  }

  let max = 0;
  for (let i = 0; i < barCount; i++) if (peaks[i] > max) max = peaks[i];
  if (max > 0) for (let i = 0; i < barCount; i++) peaks[i] /= max;

  // Power curve — exaggerate dynamic range.
  for (let i = 0; i < barCount; i++) peaks[i] = peaks[i] ** 2;

  // Two smoothing passes.
  let current = peaks;
  for (let p = 0; p < 2; p++) {
    const smoothed = new Float32Array(current.length);
    smoothed[0] = current[0];
    smoothed[current.length - 1] = current[current.length - 1];
    for (let i = 1; i < current.length - 1; i++) {
      smoothed[i] = current[i - 1] * 0.25 + current[i] * 0.5 + current[i + 1] * 0.25;
    }
    current = smoothed;
  }
  return current;
}

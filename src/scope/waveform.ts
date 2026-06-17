// Waveform peaks for the seek bar: cache-first, decode-on-miss, store. The heavy
// native decode (AstraLibraryScanner.extractWaveform) runs once per track and the
// result is cached in SQLite; downsampleWaveform shapes the cached high-res peaks
// to the display's bar count at render time (ported from desktop waveformExtractor).

import { AstraLibraryScanner } from '../../modules/astra-library-scanner';
import { openLibraryDb } from '@/db/database';
import { getWaveformPeaks, putWaveformPeaks } from '@/db/waveformQueries';

export const WAVEFORM_BINS = 512;

// Dedupe concurrent requests for the same track (e.g. mini-player + now-playing).
const inflight = new Map<string, Promise<Float32Array | null>>();

export function getWaveform(trackPath: string): Promise<Float32Array | null> {
  const existing = inflight.get(trackPath);
  if (existing) return existing;
  const task = loadWaveform(trackPath).finally(() => inflight.delete(trackPath));
  inflight.set(trackPath, task);
  return task;
}

async function loadWaveform(trackPath: string): Promise<Float32Array | null> {
  const db = await openLibraryDb();
  const cached = await getWaveformPeaks(db, trackPath);
  if (cached && cached.length > 0) return cached;

  let raw: number[];
  try {
    raw = await AstraLibraryScanner.extractWaveform(trackPath, WAVEFORM_BINS);
  } catch {
    return null;
  }
  if (!raw || raw.length === 0) return null;

  const peaks = Float32Array.from(raw);
  await putWaveformPeaks(db, trackPath, peaks).catch(() => {
    /* cache write failure is non-fatal */
  });
  return peaks;
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

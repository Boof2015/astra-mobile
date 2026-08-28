// Pure waveform shaping — no native imports, so it stays unit-testable under `node --test`
// (see waveformMath.test.mts). waveform.ts re-exports these.

/** Normalize the raw RMS prefix emitted mid-decode and leave the unfinished tail empty. */
export function normalizeProgressiveWaveform(
  prefix: Float32Array,
  totalBins: number
): Float32Array {
  const out = new Float32Array(Math.max(0, totalBins));
  if (totalBins <= 0) return out;

  const filled = Math.min(prefix.length, totalBins);
  if (filled === 0) return out;

  let prefixMax = 0;
  for (let i = 0; i < filled; i++) if (prefix[i] > prefixMax) prefixMax = prefix[i];
  if (prefixMax <= 0) return out;

  const scale = 1 / prefixMax;
  for (let i = 0; i < filled; i++) out[i] = Math.min(1, prefix[i] * scale);
  return out;
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

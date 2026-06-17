import { useEffect, useMemo, useState } from 'react';
import { AstraScope, SPECTRUM_BINS } from '../../modules/astra-scope';

const FRAME_MS = 32; // ~30fps — ambient, battery-friendly

// Display window (dB). Tighter than the raw [-100,0] capture range so music
// fills the curve with punch instead of hugging the floor.
const DISPLAY_DB_MIN = -88;
const DISPLAY_DB_MAX = -16;
const DB_RANGE = DISPLAY_DB_MAX - DISPLAY_DB_MIN;

// Map points across a log-frequency (geometric bin) axis like the desktop
// SpectrumAnalyzer, so the low end isn't squashed. Skip DC/rumble at the bottom.
const BIN_LOW = 2;
const BIN_HIGH = SPECTRUM_BINS - 1;
// Gentle upward tilt (dB/octave) so the curve reads as a shape, not a downward
// ramp dominated by bass — same idea as the desktop's spectrum tilt.
const TILT_DB_PER_OCT = 2;

// Temporal smoothing: rise instantly, fall smoothly, for a fluid line.
const RELEASE = 0.72;

// One reused buffer across all consumers: getSpectrumFrame fills it in place and
// we read it out synchronously on the JS thread, so a module-level buffer is safe.
const buffer = new Float32Array(SPECTRUM_BINS);

/**
 * Pulls the latest spectrum from the native tap on a JS-thread rAF loop (while
 * `active`) and returns `pointCount` magnitudes in [0,1] sampled on a
 * log-frequency axis, smoothed over time. Feeds the filled-line {@link
 * SpectrumCurve}. Returns all-zero (flat) points when inactive — no loop, no
 * setState — so callers render a clean baseline.
 */
export function useSpectrumCurve(pointCount: number, active: boolean): number[] {
  const [values, setValues] = useState<number[]>(() => new Array(pointCount).fill(0));
  const zeros = useMemo(() => new Array<number>(pointCount).fill(0), [pointCount]);

  useEffect(() => {
    if (!active) return; // inactive: no loop, no setState; caller gets `zeros`
    let mounted = true;
    let raf = 0;
    let last = 0;

    const smoothed = new Float32Array(pointCount);
    const logLow = Math.log(BIN_LOW);
    const logHigh = Math.log(BIN_HIGH);
    const binAt = (t: number) => Math.exp(logLow + t * (logHigh - logLow));
    const refBin = binAt(0.5); // tilt pivot (midband)

    const tick = (t: number) => {
      if (!mounted) return;
      raf = requestAnimationFrame(tick);
      if (t - last < FRAME_MS) return;
      last = t;
      if (AstraScope.getSpectrumFrame(buffer) <= 0) return;

      const out = new Array<number>(pointCount);
      for (let p = 0; p < pointCount; p++) {
        const b0 = binAt(p / pointCount);
        const b1 = binAt((p + 1) / pointCount);
        const lo = Math.max(BIN_LOW, Math.floor(b0));
        const hi = Math.min(BIN_HIGH, Math.max(lo, Math.ceil(b1)));

        // Peak (loudest bin) across the band — punchier than an average.
        let db = -200;
        for (let i = lo; i <= hi; i++) if (buffer[i] > db) db = buffer[i];

        const octaves = Math.log2(Math.max(1, (b0 + b1) * 0.5) / refBin);
        db += TILT_DB_PER_OCT * octaves;

        let norm = (db - DISPLAY_DB_MIN) / DB_RANGE;
        if (norm < 0) norm = 0;
        else if (norm > 1) norm = 1;

        const prev = smoothed[p];
        const next = norm >= prev ? norm : prev * RELEASE + norm * (1 - RELEASE);
        smoothed[p] = next;
        out[p] = next;
      }
      setValues(out);
    };

    raf = requestAnimationFrame(tick);
    return () => {
      mounted = false;
      cancelAnimationFrame(raf);
    };
  }, [active, pointCount]);

  return active ? values : zeros;
}

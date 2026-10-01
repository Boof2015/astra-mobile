// Coordinate mapping + response-curve sampling for the EQ graph. Frequency is on a
// log axis (20 Hz–20 kHz); gain is linear (±12 dB) centered vertically.

import { Skia, type SkPath } from '@shopify/react-native-skia';
import type { EQBand } from '@/types/audio';
import {
  computeCombinedEQMagnitude,
  computeEQFilterCoefficients,
  type EQFilterCoefficients,
} from '@/audio/eq';
import { GRAPH_SAMPLE_RATE, freqToX, gainToY, xToFreq } from './peqGeometry';

// The coordinate mapping lives with the rest of the editor's pure geometry so it
// can be tested under node; re-exported here for the graph's existing importers.
export { GRAPH_PAD_Y, GRAPH_SAMPLE_RATE, freqToX, gainToY, xToFreq, yToGain } from './peqGeometry';

/** Combined response curve as a stroked SkPath sampled across the width. */
export function buildResponsePath(
  bands: readonly EQBand[],
  width: number,
  height: number,
  samples = 96
): SkPath {
  const path = Skia.Path.Make();
  if (width <= 0 || height <= 0) return path;
  for (let i = 0; i <= samples; i++) {
    const x = (i / samples) * width;
    const freq = xToFreq(x, width);
    const db = computeCombinedEQMagnitude(bands, freq, GRAPH_SAMPLE_RATE);
    const y = gainToY(db, height);
    if (i === 0) path.moveTo(x, y);
    else path.lineTo(x, y);
  }
  return path;
}

/**
 * Everything about the sample points that doesn't depend on a band: each
 * sample's x and the trig of its frequency. Built once per graph width on the
 * JS thread, then captured by the UI-thread curve builders below, so a frame
 * costs one coefficient set per band plus a few multiplies per sample.
 */
export interface CurveTable {
  width: number;
  xs: number[];
  cos1: number[];
  sin1: number[];
  cos2: number[];
  sin2: number[];
}

export function buildCurveTable(width: number, samples = 96): CurveTable {
  const table: CurveTable = { width, xs: [], cos1: [], sin1: [], cos2: [], sin2: [] };
  for (let i = 0; i <= samples; i++) {
    const x = (i / samples) * width;
    const w = (2 * Math.PI * xToFreq(x, width)) / GRAPH_SAMPLE_RATE;
    table.xs.push(x);
    table.cos1.push(Math.cos(w));
    table.sin1.push(Math.sin(w));
    table.cos2.push(Math.cos(2 * w));
    table.sin2.push(Math.sin(2 * w));
  }
  return table;
}

/** One biquad's gain in dB at sample `i` — the magnitude of H(e^jw), via the table. */
function dbAt(c: EQFilterCoefficients, t: CurveTable, i: number): number {
  'worklet';
  const nr = c.b0 + c.b1 * t.cos1[i] + c.b2 * t.cos2[i];
  const ni = -c.b1 * t.sin1[i] - c.b2 * t.sin2[i];
  const dr = 1 + c.a1 * t.cos1[i] + c.a2 * t.cos2[i];
  const di = -c.a1 * t.sin1[i] - c.a2 * t.sin2[i];
  return 10 * Math.log10((nr * nr + ni * ni) / (dr * dr + di * di + 1e-40) + 1e-40);
}

/** One band's own response outline. */
export function buildBandLinePath(band: EQBand, t: CurveTable, height: number): SkPath {
  'worklet';
  const path = Skia.Path.Make();
  if (t.width <= 0 || height <= 0) return path;
  const c = computeEQFilterCoefficients(band, GRAPH_SAMPLE_RATE);
  for (let i = 0; i < t.xs.length; i++) {
    const y = gainToY(dbAt(c, t, i), height);
    if (i === 0) path.moveTo(t.xs[i], y);
    else path.lineTo(t.xs[i], y);
  }
  return path;
}

/** The summed response of every enabled band. */
export function buildCombinedLinePath(bands: readonly EQBand[], t: CurveTable, height: number): SkPath {
  'worklet';
  const path = Skia.Path.Make();
  if (t.width <= 0 || height <= 0) return path;
  const coefficients: EQFilterCoefficients[] = [];
  for (const band of bands) {
    if (band.enabled !== false) coefficients.push(computeEQFilterCoefficients(band, GRAPH_SAMPLE_RATE));
  }
  for (let i = 0; i < t.xs.length; i++) {
    let db = 0;
    for (const c of coefficients) db += dbAt(c, t, i);
    const y = gainToY(db, height);
    if (i === 0) path.moveTo(t.xs[i], y);
    else path.lineTo(t.xs[i], y);
  }
  return path;
}

/** A copy of an outline closed down to the 0 dB line, for its fill. */
export function closeToBaseline(line: SkPath, width: number, height: number): SkPath {
  'worklet';
  const fill = line.copy();
  fill.lineTo(width, height / 2);
  fill.lineTo(0, height / 2);
  fill.close();
  return fill;
}

/** Closes a copy of the response path down to the baseline for a soft fill. */
export function buildResponseFill(line: SkPath, width: number, height: number): SkPath {
  const fill = line.copy();
  fill.lineTo(width, height / 2);
  fill.lineTo(0, height / 2);
  fill.close();
  return fill;
}

/**
 * The log grid: a faint line at every 2–9 multiple inside each decade, stronger
 * lines at the decades and every 6 dB, and the 0 dB line on its own so it can
 * be drawn strongest.
 */
export function buildGridPaths(width: number, height: number): { minor: SkPath; major: SkPath; zero: SkPath } {
  const minor = Skia.Path.Make();
  const major = Skia.Path.Make();
  const zero = Skia.Path.Make();
  if (width <= 0 || height <= 0) return { minor, major, zero };
  const vLine = (path: SkPath, freq: number) => {
    const x = freqToX(freq, width);
    path.moveTo(x, 0);
    path.lineTo(x, height);
  };
  const hLine = (path: SkPath, db: number) => {
    const y = gainToY(db, height);
    path.moveTo(0, y);
    path.lineTo(width, y);
  };
  for (const decade of [10, 100, 1000, 10000]) {
    for (let m = 2; m <= 9; m++) {
      const freq = decade * m;
      if (freq > 20 && freq < 20000) vLine(minor, freq);
    }
  }
  for (const freq of [100, 1000, 10000]) vLine(major, freq);
  for (const db of [-9, -3, 3, 9]) hLine(minor, db);
  for (const db of [-12, -6, 6, 12]) hLine(major, db);
  hLine(zero, 0);
  return { minor, major, zero };
}

/** Frequency labels along the bottom axis — one per 1-2-5 step. */
export const FREQ_TICKS: { freq: number; label: string }[] = [
  { freq: 20, label: '20' },
  { freq: 50, label: '50' },
  { freq: 100, label: '100' },
  { freq: 200, label: '200' },
  { freq: 500, label: '500' },
  { freq: 1000, label: '1k' },
  { freq: 2000, label: '2k' },
  { freq: 5000, label: '5k' },
  { freq: 10000, label: '10k' },
  { freq: 20000, label: '20k' },
];

/** Gain labels up the right edge. */
export const GAIN_TICKS = [12, 6, 0, -6, -12];

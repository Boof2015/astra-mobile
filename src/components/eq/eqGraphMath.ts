// Coordinate mapping + response-curve sampling for the EQ graph. Frequency is on a
// log axis (20 Hz–20 kHz); gain is linear (±12 dB) centered vertically.

import { Skia, type SkPath } from '@shopify/react-native-skia';
import type { EQBand } from '@/types/audio';
import {
  EQ_MAX_FREQUENCY,
  EQ_MAX_GAIN_DB,
  EQ_MIN_FREQUENCY,
  computeCombinedEQMagnitude,
} from '@/audio/eq';

export const GRAPH_SAMPLE_RATE = 48000;
export const GRAPH_PAD_Y = 14; // px headroom so ±12 dB nodes aren't clipped
const LOG_MIN = Math.log10(EQ_MIN_FREQUENCY);
const LOG_MAX = Math.log10(EQ_MAX_FREQUENCY);
const LOG_SPAN = LOG_MAX - LOG_MIN;

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

export function freqToX(freq: number, width: number): number {
  const f = clamp(freq, EQ_MIN_FREQUENCY, EQ_MAX_FREQUENCY);
  return ((Math.log10(f) - LOG_MIN) / LOG_SPAN) * width;
}

export function xToFreq(x: number, width: number): number {
  const t = clamp(width > 0 ? x / width : 0, 0, 1);
  return 10 ** (LOG_MIN + t * LOG_SPAN);
}

export function gainToY(gainDb: number, height: number): number {
  const center = height / 2;
  const usable = center - GRAPH_PAD_Y;
  return center - (clamp(gainDb, -EQ_MAX_GAIN_DB, EQ_MAX_GAIN_DB) / EQ_MAX_GAIN_DB) * usable;
}

export function yToGain(y: number, height: number): number {
  const center = height / 2;
  const usable = center - GRAPH_PAD_Y;
  if (usable <= 0) return 0;
  return clamp(((center - y) / usable) * EQ_MAX_GAIN_DB, -EQ_MAX_GAIN_DB, EQ_MAX_GAIN_DB);
}

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

/** Closes a copy of the response path down to the baseline for a soft fill. */
export function buildResponseFill(line: SkPath, width: number, height: number): SkPath {
  const fill = line.copy();
  fill.lineTo(width, height / 2);
  fill.lineTo(0, height / 2);
  fill.close();
  return fill;
}

/** Frequency gridline positions + labels shown along the bottom axis. */
export const FREQ_TICKS: { freq: number; label: string }[] = [
  { freq: 30, label: '30' },
  { freq: 100, label: '100' },
  { freq: 500, label: '500' },
  { freq: 1000, label: '1k' },
  { freq: 5000, label: '5k' },
  { freq: 15000, label: '15k' },
];

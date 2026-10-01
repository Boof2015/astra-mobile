// Pure geometry for the parametric EQ editor: graph coordinates, the Q lines
// drawn around the selected band, graph hit-testing, and the scrub mappings the
// band panel uses. No Skia or RN imports, so all of it runs under `node --test`.
//
// Most of it also runs on the UI thread, as worklets. A worklet captures the
// helpers it calls where it is *declared*, so declare a helper above every
// worklet that calls it — hoisting doesn't apply (workletOrder.test.mts).

import type { EQBand, EQBandType } from '../../types/audio.ts';
import {
  EQ_MAX_FREQUENCY,
  EQ_MAX_GAIN_DB,
  EQ_MAX_Q,
  EQ_MIN_FREQUENCY,
  EQ_MIN_Q,
  clampEQFrequency,
  clampEQGain,
  clampEQQ,
  computeEQFilterMagnitude,
  isPassEQBandType,
} from '../../audio/eq.ts';

export const GRAPH_PAD_Y = 14; // px headroom so ±12 dB nodes aren't clipped
/** The graph's display sample rate — native uses the real stream rate. */
export const GRAPH_SAMPLE_RATE = 48000;
const LOG_MIN = Math.log10(EQ_MIN_FREQUENCY);
const LOG_MAX = Math.log10(EQ_MAX_FREQUENCY);
const LOG_SPAN = LOG_MAX - LOG_MIN;

/** Band node radius on the graph. */
export const NODE_R = 10;
/** A touch this close to a node grabs it. Nodes beat Q lines. */
export const NODE_HIT_RADIUS = 28;
/** A touch this far either side of a Q line grabs it, anywhere along its height. */
export const Q_LINE_HIT_HALF = 18;
/**
 * Q drag feel for narrow bands. A phone graph gets ~36 dp per octave, so Q 4 to
 * Q 18 is under 7 dp of real half-width: glue a line to the finger there and a
 * twitch sweeps most of the range. So the *drag* works in its own space — the
 * true half-width for wide bands, an even step per Q doubling for narrow ones —
 * while the lines are always *drawn* at the true edges. Near the node the line
 * trails the finger instead of being drawn somewhere it isn't.
 */
export const Q_DRAG_FLOOR = 10;
export const Q_DRAG_DP_PER_DOUBLING = 8;
const Q_DRAG_DP_PER_E_FOLD = Q_DRAG_DP_PER_DOUBLING / Math.LN2;

function clamp(v: number, min: number, max: number): number {
  'worklet';
  return Math.max(min, Math.min(max, v));
}

// --- coordinates -------------------------------------------------------------

export function freqToX(freq: number, width: number): number {
  'worklet';
  const f = clamp(freq, EQ_MIN_FREQUENCY, EQ_MAX_FREQUENCY);
  return ((Math.log10(f) - LOG_MIN) / LOG_SPAN) * width;
}

export function xToFreq(x: number, width: number): number {
  'worklet';
  const t = clamp(width > 0 ? x / width : 0, 0, 1);
  return 10 ** (LOG_MIN + t * LOG_SPAN);
}

export function gainToY(gainDb: number, height: number): number {
  'worklet';
  const center = height / 2;
  const usable = center - GRAPH_PAD_Y;
  return center - (clamp(gainDb, -EQ_MAX_GAIN_DB, EQ_MAX_GAIN_DB) / EQ_MAX_GAIN_DB) * usable;
}

export function yToGain(y: number, height: number): number {
  'worklet';
  const center = height / 2;
  const usable = center - GRAPH_PAD_Y;
  if (usable <= 0) return 0;
  return clamp(((center - y) / usable) * EQ_MAX_GAIN_DB, -EQ_MAX_GAIN_DB, EQ_MAX_GAIN_DB);
}

/**
 * The gain a band's node is drawn at. A pass filter has no gain — its node sits
 * on the 0 dB line whatever the stored value says.
 */
export function bandNodeGain(band: { type: EQBandType; gain: number }): number {
  'worklet';
  return isPassEQBandType(band.type) ? 0 : band.gain;
}

// --- quantizing --------------------------------------------------------------

/** Within this of 0 dB, a dragged gain lands on exactly 0. */
export const GAIN_SNAP_DB = 0.25;

export function quantizeFrequency(hz: number): number {
  'worklet';
  return clampEQFrequency(Math.round(hz));
}

export function quantizeQ(Q: number): number {
  'worklet';
  return clampEQQ(Math.round(clampEQQ(Q) * 100) / 100);
}

/** Dragged gain: 0 dB is magnetic, everything else lands on a tenth. */
export function quantizeGain(db: number): number {
  'worklet';
  if (Math.abs(db) < GAIN_SNAP_DB) return 0;
  return clampEQGain(Math.round(db * 10) / 10);
}

// --- Q lines -----------------------------------------------------------------

/**
 * The cookbook's digital correction: a band's bandwidth in octaves shrinks by
 * sin(w0)/w0 as it nears Nyquist. With it, a peaking band's edges land where its
 * own curve is at half its gain.
 */
function bandwidthWarp(frequency: number): number {
  'worklet';
  const w0 = (2 * Math.PI * frequency) / GRAPH_SAMPLE_RATE;
  return w0 > 0 ? Math.sin(w0) / w0 : 1;
}

/** RBJ cookbook bandwidth, in octaves, of a band with this Q at this frequency. */
export function bandwidthOctaves(Q: number, frequency?: number): number {
  'worklet';
  const analog = (2 / Math.LN2) * Math.asinh(1 / (2 * Math.max(Q, 1e-6)));
  return frequency === undefined ? analog : analog * bandwidthWarp(frequency);
}

/** Inverse of `bandwidthOctaves`. A zero-width band is the narrowest Q there is. */
export function qFromBandwidth(octaves: number, frequency?: number): number {
  'worklet';
  const analog = frequency === undefined ? octaves : octaves / bandwidthWarp(frequency);
  if (!(analog > 0)) return EQ_MAX_Q;
  return 1 / (2 * Math.sinh((Math.LN2 * analog) / 2));
}

export function pxPerOctave(width: number): number {
  'worklet';
  return (width * Math.log10(2)) / LOG_SPAN;
}

/** Where a band's bandwidth edges are, in Hz. */
export function bandEdges(band: Pick<EQBand, 'frequency' | 'Q'>): { low: number; high: number } {
  'worklet';
  const half = bandwidthOctaves(band.Q, band.frequency) / 2;
  return { low: band.frequency / 2 ** half, high: band.frequency * 2 ** half };
}

export type QLineSide = 'low' | 'high';

export interface QLine {
  x: number;
  /** Where the band's own curve crosses the line — the handle sits here. */
  y: number;
}

export interface QLines {
  /** Each line, or null where it falls off the graph. */
  low: QLine | null;
  high: QLine | null;
}

/**
 * The selected band's Q lines, drawn at its true bandwidth edges with a handle
 * on the band's own curve (for a peaking band, where it is at half its gain).
 * Shelves reuse the same edges as a stand-in for transition width. Pass
 * filters get none — their Q is resonance in dB, which no width can honestly
 * draw.
 */
export function qLines(band: EQBand, width: number, height: number): QLines | null {
  'worklet';
  if (isPassEQBandType(band.type) || width <= 0 || height <= 0) return null;
  const edges = bandEdges(band);
  const line = (frequency: number): QLine | null =>
    frequency < EQ_MIN_FREQUENCY || frequency > EQ_MAX_FREQUENCY
      ? null
      : {
          x: freqToX(frequency, width),
          y: gainToY(computeEQFilterMagnitude(band, frequency, GRAPH_SAMPLE_RATE), height),
        };
  return { low: line(edges.low), high: line(edges.high) };
}

/** Position of a Q in the drag space (see `Q_DRAG_FLOOR`), in px from the node. */
export function qDragOffset(Q: number, frequency: number, width: number): number {
  'worklet';
  const trueHalf = (bandwidthOctaves(Q, frequency) / 2) * pxPerOctave(width);
  return Math.max(trueHalf, Q_DRAG_FLOOR + Q_DRAG_DP_PER_E_FOLD * Math.log(EQ_MAX_Q / clampEQQ(Q)));
}

/**
 * Inverse of `qDragOffset`. For a max of two decreasing functions the inverse
 * is the larger of their inverses — the one whose curve is actually on top.
 */
export function qFromDragOffset(offset: number, frequency: number, width: number): number {
  'worklet';
  const perOctave = pxPerOctave(width);
  const fromTrue = perOctave > 0 ? qFromBandwidth((2 * Math.max(0, offset)) / perOctave, frequency) : EQ_MAX_Q;
  const fromLog = EQ_MAX_Q * Math.exp(-(offset - Q_DRAG_FLOOR) / Q_DRAG_DP_PER_E_FOLD);
  return clampEQQ(Math.max(fromTrue, fromLog));
}

/**
 * Q after a line drag. Distances are the finger's reach from the node on the
 * grabbed line's side (`qLineReach`), at grant and now: outward widens the
 * band, inward narrows it.
 */
export function qFromLineDrag(
  start: Pick<EQBand, 'frequency' | 'Q'>,
  startDistance: number,
  distance: number,
  width: number
): number {
  'worklet';
  const offset = qDragOffset(start.Q, start.frequency, width) + (distance - startDistance);
  return quantizeQ(qFromDragOffset(offset, start.frequency, width));
}

/**
 * How far out a finger at `x` is on the grabbed line's side of the node —
 * negative once it has crossed to the other side. Signed, so a line never
 * swaps sides: dragging it inward past its node keeps narrowing until Q stops
 * at its maximum (the wall), and the line stays pinned beside the node.
 */
export function qLineReach(side: QLineSide, x: number, nodeX: number): number {
  'worklet';
  return side === 'high' ? x - nodeX : nodeX - x;
}

/**
 * Whether the lines sit too close together to tell which one a touch meant —
 * then the first drag direction picks: rightward is the high line, leftward
 * the low one. Without this, a narrow band grabbed by the "wrong" line could
 * only be dragged into the wall.
 */
export function qLinesOverlap(lines: QLines): boolean {
  'worklet';
  return lines.low !== null && lines.high !== null && lines.high.x - lines.low.x < 2 * Q_LINE_HIT_HALF;
}

/** Whether a Q sits on either wall — the narrowest or the widest band. */
export function qAtLimit(Q: number): boolean {
  'worklet';
  return Q <= EQ_MIN_Q || Q >= EQ_MAX_Q;
}

// --- hit-testing -------------------------------------------------------------

export interface GraphNode {
  id: string;
  x: number;
  y: number;
}

export type GraphHit = { kind: 'node'; id: string } | { kind: 'q'; side: QLineSide } | null;

/**
 * What a touch at (x, y) grabs: the nearest node (the selected band wins a
 * tie), else one of the selected band's Q lines, else nothing — a tap on empty
 * graph keeps the current selection.
 */
export function hitTestGraph(
  x: number,
  y: number,
  nodes: readonly GraphNode[],
  activeId: string | null,
  lines: QLines | null
): GraphHit {
  'worklet';
  let bestId: string | null = null;
  let bestDist = NODE_HIT_RADIUS * NODE_HIT_RADIUS;
  for (const node of nodes) {
    const d = (node.x - x) ** 2 + (node.y - y) ** 2;
    if (d < bestDist || (d === bestDist && (bestId === null || node.id === activeId))) {
      bestDist = d;
      bestId = node.id;
    }
  }
  if (bestId !== null) return { kind: 'node', id: bestId };

  if (!lines) return null;
  const lowDist = lines.low === null ? Infinity : Math.abs(x - lines.low.x);
  const highDist = lines.high === null ? Infinity : Math.abs(x - lines.high.x);
  const side: QLineSide = lowDist <= highDist ? 'low' : 'high';
  return Math.min(lowDist, highDist) <= Q_LINE_HIT_HALF ? { kind: 'q', side } : null;
}

// --- scrubbing ---------------------------------------------------------------

export type PEQParam = 'frequency' | 'Q' | 'gain';

/** Finger travel for one octave of frequency, or one doubling of Q. */
export const SCRUB_DP_PER_OCTAVE = 80;
/** Finger travel for one dB of gain. */
export const SCRUB_DP_PER_DB = 20;

/**
 * A scrub is relative: the value moves by how far the finger has travelled
 * since it went down, never to where it is. Zero travel returns the start value
 * untouched, so a typed exact value is never rounded by merely touching it.
 */
export function scrubValue(param: PEQParam, start: number, dx: number): number {
  if (dx === 0) return start;
  switch (param) {
    case 'frequency':
      return quantizeFrequency(start * 2 ** (dx / SCRUB_DP_PER_OCTAVE));
    case 'Q':
      return quantizeQ(start * 2 ** (dx / SCRUB_DP_PER_OCTAVE));
    case 'gain':
      return quantizeGain(start + dx / SCRUB_DP_PER_DB);
  }
}

/** One accessibility increment (+1) or decrement (-1). */
export function stepValue(param: PEQParam, value: number, direction: 1 | -1): number {
  switch (param) {
    case 'frequency':
      return quantizeFrequency(value * 2 ** (direction / 6));
    case 'Q':
      return quantizeQ(value * 1.1 ** direction);
    case 'gain':
      return clampEQGain(Math.round((value + direction * 0.5) * 10) / 10);
  }
}

/** Where a value sits in its range, 0..1 — log for frequency and Q. */
export function paramFraction(param: PEQParam, value: number): number {
  switch (param) {
    case 'frequency':
      return logFraction(value, EQ_MIN_FREQUENCY, EQ_MAX_FREQUENCY);
    case 'Q':
      return logFraction(value, EQ_MIN_Q, EQ_MAX_Q);
    case 'gain':
      return clamp((value + EQ_MAX_GAIN_DB) / (2 * EQ_MAX_GAIN_DB), 0, 1);
  }
}

function logFraction(value: number, min: number, max: number): number {
  const lo = Math.log10(min);
  const hi = Math.log10(max);
  return clamp((Math.log10(Math.max(min, value)) - lo) / (hi - lo), 0, 1);
}

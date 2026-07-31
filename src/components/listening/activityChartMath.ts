// Geometry + reveal timing for the listening activity chart. Kept free of React
// Native and Skia imports so the maths stay unit-testable, mirroring the split
// between EQGraph.tsx and eqGraphMath.ts.
//
// Every bar position is an absolute pixel value derived from one measured width.
// The chart deliberately owns no flex/percentage layout: the previous
// implementation nested flexed bar slots inside a horizontal ScrollView whose
// contentContainer used `width: '100%'`, which resolves to auto on an
// unconstrained main axis and collapsed every slot to zero width.

/** Plot area height in px (excludes the axis label row below it). */
export const CHART_PLOT_HEIGHT = 132;
/** Widest a single bar may get, so a 3-bucket "All" range doesn't draw slabs. */
export const BAR_MAX_WIDTH = 22;
/** Narrowest a bar may get, so ~53 weekly buckets stay visible. */
export const BAR_MIN_WIDTH = 2;
/** Height of the tick drawn for a bucket with no listening at all. */
export const BAR_EMPTY_HEIGHT = 2;
/** How far the reveal is spread across the bars; see `staggerProgress`. */
export const WIPE_SPREAD = 0.45;

export interface BarSlot {
  x: number;
  width: number;
  radius: number;
}

function clamp(value: number, min: number, max: number): number {
  'worklet';
  return Math.max(min, Math.min(max, value));
}

/**
 * Bar rectangles spanning the full measured width — bar count drives bar width,
 * so no range ever needs to scroll.
 */
export function barSlots(count: number, width: number): BarSlot[] {
  if (count <= 0 || !(width > 0)) return [];
  const slot = width / count;
  const gap = clamp(slot * 0.28, 1, 8);
  const barWidth = clamp(slot - gap, BAR_MIN_WIDTH, BAR_MAX_WIDTH);
  const radius = Math.min(barWidth / 2, 4);
  const slots: BarSlot[] = [];
  for (let i = 0; i < count; i++) {
    slots.push({ x: i * slot + (slot - barWidth) / 2, width: barWidth, radius });
  }
  return slots;
}

/**
 * Bar heights in px, normalised against the largest value.
 *
 * Non-finite and negative values are coerced to 0 rather than propagated: the
 * old `Math.max(1, ...values)` form turned a single NaN into a NaN maximum,
 * which flattened every bar in the chart.
 */
export function barHeights(values: readonly number[], plotHeight: number): number[] {
  const usable = plotHeight > 0 ? plotHeight : 0;
  let max = 0;
  for (const value of values) {
    if (Number.isFinite(value) && value > max) max = value;
  }
  if (max <= 0 || usable <= 0) return values.map(() => 0);
  return values.map((value) =>
    Number.isFinite(value) && value > 0 ? (value / max) * usable : 0,
  );
}

/** Bucket under a touch at `x`, for tap-and-drag scrubbing. -1 when empty. */
export function nearestBarIndex(x: number, count: number, width: number): number {
  if (count <= 0 || !(width > 0)) return -1;
  const slot = width / count;
  return clamp(Math.floor(x / slot), 0, count - 1);
}

/**
 * Per-bar reveal progress, so growth sweeps left to right instead of every bar
 * inflating together. Bar 0 starts immediately; the last bar starts `spread`
 * of the way through; all of them land on 1 when `progress` reaches 1.
 *
 * Marked as a worklet: this runs inside the Skia path builder on the UI thread.
 */
export function staggerProgress(
  progress: number,
  index: number,
  count: number,
  spread: number,
): number {
  'worklet';
  if (count <= 1) return clamp(progress, 0, 1);
  const start = (index / (count - 1)) * spread;
  return clamp(progress * (1 + spread) - start, 0, 1);
}

/**
 * Drawn height of one bar, combining the two animations the chart runs:
 * `settle` (0–1) glides from the previously drawn heights to the current ones
 * when a refresh lands, and `reveal` (0–1) is the staggered growth sweep.
 *
 * Empty buckets keep a hairline tick so the baseline stays readable.
 */
export function animatedBarHeight(
  from: readonly number[],
  to: readonly number[],
  settle: number,
  reveal: number,
  index: number,
  count: number,
): number {
  'worklet';
  const start = from[index] ?? 0;
  const end = to[index] ?? 0;
  const target = start + (end - start) * settle;
  return Math.max(target * staggerProgress(reveal, index, count, WIPE_SPREAD), BAR_EMPTY_HEIGHT);
}

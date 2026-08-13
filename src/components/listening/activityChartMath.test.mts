import assert from 'node:assert/strict';
import test from 'node:test';
import {
  BAR_EMPTY_HEIGHT,
  BAR_MAX_WIDTH,
  BAR_MIN_WIDTH,
  WIPE_SPREAD,
  animatedBarHeight,
  barHeights,
  barSlots,
  nearestBarIndex,
  staggerProgress,
} from './activityChartMath.ts';

test('bar slots span the measured width for every supported bucket count', () => {
  const width = 320;
  for (const count of [1, 3, 7, 30, 53, 120]) {
    const slots = barSlots(count, width);
    assert.equal(slots.length, count);
    const first = slots[0];
    const last = slots[count - 1];
    assert.ok(first.x >= 0, `count ${count} starts off-canvas at ${first.x}`);
    assert.ok(
      last.x + last.width <= width + 0.001,
      `count ${count} overflows: ${last.x + last.width} > ${width}`,
    );
    for (const slot of slots) {
      assert.ok(slot.width >= BAR_MIN_WIDTH, `bar too thin at count ${count}`);
      assert.ok(slot.width <= BAR_MAX_WIDTH, `bar too wide at count ${count}`);
    }
  }
});

test('bar slots are evenly pitched and centred in their slot', () => {
  const slots = barSlots(7, 350);
  const pitch = slots[1].x - slots[0].x;
  for (let i = 1; i < slots.length; i++) {
    assert.ok(Math.abs(slots[i].x - slots[i - 1].x - pitch) < 0.001, 'uneven pitch');
  }
  const leadingGap = slots[0].x;
  const trailingGap = 350 - (slots[6].x + slots[6].width);
  assert.ok(Math.abs(leadingGap - trailingGap) < 0.001, 'chart is not centred');
});

test('bar slots degrade to empty rather than NaN for unmeasured layouts', () => {
  assert.deepEqual(barSlots(7, 0), []);
  assert.deepEqual(barSlots(0, 320), []);
  assert.deepEqual(barSlots(7, Number.NaN), []);
  assert.deepEqual(barSlots(-3, 320), []);
});

test('bar heights normalise against the largest bucket', () => {
  assert.deepEqual(barHeights([0, 50, 100], 100), [0, 50, 100]);
  assert.deepEqual(barHeights([10, 10, 10], 60), [60, 60, 60]);
});

test('a single bad bucket cannot flatten the whole chart', () => {
  // Regression: `Math.max(1, ...values)` propagated NaN into every bar height,
  // which rendered every bar at its 3px minimum.
  const heights = barHeights([10, Number.NaN, 20, Infinity, -5], 100);
  assert.deepEqual(heights, [50, 0, 100, 0, 0]);
  for (const height of heights) {
    assert.ok(Number.isFinite(height), 'height must never be NaN or Infinity');
  }
});

test('bar heights are all zero when there is nothing to plot', () => {
  assert.deepEqual(barHeights([0, 0, 0], 100), [0, 0, 0]);
  assert.deepEqual(barHeights([5, 5], 0), [0, 0]);
  assert.deepEqual(barHeights([], 100), []);
});

test('touches map to the bucket under the finger and clamp at both edges', () => {
  assert.equal(nearestBarIndex(0, 7, 350), 0);
  assert.equal(nearestBarIndex(349, 7, 350), 6);
  assert.equal(nearestBarIndex(175, 7, 350), 3);
  // Overshooting past either end holds the outermost bucket rather than wrapping.
  assert.equal(nearestBarIndex(-40, 7, 350), 0);
  assert.equal(nearestBarIndex(999, 7, 350), 6);
  assert.equal(nearestBarIndex(10, 0, 350), -1);
  assert.equal(nearestBarIndex(10, 7, 0), -1);
});

test('the reveal sweeps left to right and every bar finishes together', () => {
  const count = 10;
  // Partway through, earlier bars lead later ones.
  const midway = Array.from({ length: count }, (_, i) =>
    staggerProgress(0.5, i, count, WIPE_SPREAD),
  );
  for (let i = 1; i < count; i++) {
    assert.ok(midway[i] <= midway[i - 1], `bar ${i} outran bar ${i - 1}`);
  }
  assert.ok(midway[0] > midway[count - 1], 'no visible sweep across the chart');

  // Nothing is showing at 0, and everything is fully grown at 1.
  for (let i = 0; i < count; i++) {
    assert.equal(staggerProgress(0, i, count, WIPE_SPREAD), 0);
    assert.equal(staggerProgress(1, i, count, WIPE_SPREAD), 1);
  }
});

test('bars grow to their settled height once both animations finish', () => {
  const from = [0, 0, 0];
  const to = [40, 80, 120];
  const grown = to.map((_, i) => animatedBarHeight(from, to, 1, 1, i, to.length));
  assert.deepEqual(grown, [40, 80, 120]);
});

test('a refresh glides bars between the old and new heights', () => {
  const from = [100, 20];
  const to = [50, 60];
  // Halfway through the settle, with the reveal already finished.
  const midway = to.map((_, i) => animatedBarHeight(from, to, 0.5, 1, i, to.length));
  assert.deepEqual(midway, [75, 40]);
});

test('empty buckets keep a hairline tick rather than vanishing', () => {
  assert.equal(animatedBarHeight([0], [0], 1, 1, 0, 1), BAR_EMPTY_HEIGHT);
  // Also holds mid-reveal, and for indices past the end of the data.
  assert.equal(animatedBarHeight([0], [90], 1, 0, 0, 1), BAR_EMPTY_HEIGHT);
  assert.equal(animatedBarHeight([], [], 1, 1, 7, 3), BAR_EMPTY_HEIGHT);
});

test('the reveal stays bounded for degenerate bucket counts', () => {
  assert.equal(staggerProgress(0.5, 0, 1, WIPE_SPREAD), 0.5);
  assert.equal(staggerProgress(1, 0, 1, WIPE_SPREAD), 1);
  assert.equal(staggerProgress(2, 3, 10, WIPE_SPREAD), 1);
  assert.equal(staggerProgress(-1, 3, 10, WIPE_SPREAD), 0);
});

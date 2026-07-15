import assert from 'node:assert/strict';
import test from 'node:test';
import {
  SCRUB_DETENT_SPACING_DP,
  SCRUB_TICK_ACTIVATION_DISTANCE_DP,
  SCRUB_TICK_MIN_INTERVAL_MS,
  beginScrubDetents,
  updateScrubDetents,
} from './waveformScrubDetents.ts';

test('begins silently and stays silent within one detent or while stationary', () => {
  const initial = beginScrubDetents(4, 120);
  assert.deepEqual(initial, {
    detentIndex: 0,
    lastTickAtMs: null,
    startPositionDp: 4,
    activated: false,
  });

  const movedInside = updateScrubDetents(initial, 11, 120, 1_000);
  assert.equal(movedInside.shouldTick, false);
  const held = updateScrubDetents(movedInside.state, 11, 120, 10_000);
  assert.equal(held.shouldTick, false);
});

test('keeps tap jitter silent even when it crosses a detent boundary', () => {
  const initial = beginScrubDetents(11, 120);
  const jitter = updateScrubDetents(
    initial,
    11 + SCRUB_TICK_ACTIVATION_DISTANCE_DP - 1,
    120,
    1_000
  );
  assert.equal(jitter.state.detentIndex, 1);
  assert.equal(jitter.state.activated, false);
  assert.equal(jitter.shouldTick, false);

  const held = updateScrubDetents(jitter.state, 16, 120, 10_000);
  assert.equal(held.shouldTick, false);
});

test('emits one step whenever slow movement crosses a spatial detent', () => {
  const initial = beginScrubDetents(0, 120);
  const first = updateScrubDetents(initial, SCRUB_DETENT_SPACING_DP, 120, 1_000);
  assert.equal(first.shouldTick, true);
  const second = updateScrubDetents(
    first.state,
    SCRUB_DETENT_SPACING_DP * 2,
    120,
    1_000 + SCRUB_TICK_MIN_INTERVAL_MS
  );
  assert.equal(second.shouldTick, true);
});

test('rate-limits fast crossings without queuing a catch-up tick', () => {
  const initial = beginScrubDetents(0, 120);
  const first = updateScrubDetents(initial, SCRUB_DETENT_SPACING_DP, 120, 1_000);
  const skipped = updateScrubDetents(
    first.state,
    SCRUB_DETENT_SPACING_DP * 3,
    120,
    1_020
  );

  assert.equal(skipped.shouldTick, false);
  assert.equal(skipped.state.detentIndex, 3);

  const heldAfterLimit = updateScrubDetents(
    skipped.state,
    SCRUB_DETENT_SPACING_DP * 3,
    120,
    2_000
  );
  assert.equal(heldAfterLimit.shouldTick, false);

  const nextMovement = updateScrubDetents(
    heldAfterLimit.state,
    SCRUB_DETENT_SPACING_DP * 4,
    120,
    2_001
  );
  assert.equal(nextMovement.shouldTick, true);
});

test('direction reversals tick only when they cross a different detent', () => {
  const initial = beginScrubDetents(30, 120);
  const forward = updateScrubDetents(initial, 48, 120, 1_000);
  assert.equal(forward.shouldTick, true);

  const sameDetent = updateScrubDetents(forward.state, 49, 120, 1_100);
  assert.equal(sameDetent.shouldTick, false);

  const reverse = updateScrubDetents(sameDetent.state, 35, 120, 1_100);
  assert.equal(reverse.shouldTick, true);
});

test('clamps out-of-bounds and invalid positions to the waveform', () => {
  const beforeStart = beginScrubDetents(-100, 120);
  assert.equal(beforeStart.detentIndex, 0);

  const pastEnd = updateScrubDetents(beforeStart, 999, 120, 1_000);
  assert.equal(pastEnd.state.detentIndex, Math.floor(120 / SCRUB_DETENT_SPACING_DP));
  assert.equal(pastEnd.shouldTick, true);

  const invalid = beginScrubDetents(Number.NaN, 0);
  assert.deepEqual(invalid, {
    detentIndex: 0,
    lastTickAtMs: null,
    startPositionDp: 0,
    activated: false,
  });
});

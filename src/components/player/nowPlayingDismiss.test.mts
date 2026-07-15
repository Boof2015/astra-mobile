import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveNowPlayingDismissSpring } from './nowPlayingDismiss.ts';

test('preserves ordinary downward release velocity and spring', () => {
  for (const velocity of [0, 1, 500, 999, 1000]) {
    assert.deepEqual(resolveNowPlayingDismissSpring(velocity, 760), {
      velocity,
      stiffness: 240,
      damping: 28,
    });
  }
});

test('normalizes upward and invalid release velocity', () => {
  for (const velocity of [-1000, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.deepEqual(resolveNowPlayingDismissSpring(velocity, 760), {
      velocity: 0,
      stiffness: 240,
      damping: 28,
    });
  }
});

test('keeps extreme release velocity continuous while increasing spring control', () => {
  const rawVelocities = [1001, 1400, 2600, 5000, 10_000];
  const springs = rawVelocities.map((velocity) =>
    resolveNowPlayingDismissSpring(velocity, 760)
  );

  for (let index = 0; index < springs.length; index += 1) {
    assert.equal(springs[index].velocity, rawVelocities[index]);
    assert.ok(springs[index].stiffness > 240);
    assert.ok(springs[index].stiffness < 480);
    assert.ok(springs[index].damping > 28);
    assert.ok(springs[index].damping < 60);
  }

  for (let index = 1; index < springs.length; index += 1) {
    assert.ok(springs[index].stiffness > springs[index - 1].stiffness);
    assert.ok(springs[index].damping > springs[index - 1].damping);
  }

  const springAt5000 = resolveNowPlayingDismissSpring(5000, 760);
  const expectedProgress = 1 - Math.exp(-1);
  assert.ok(Math.abs(springAt5000.stiffness - (240 + 240 * expectedProgress)) < 1e-9);
  assert.ok(Math.abs(springAt5000.damping - (28 + 32 * expectedProgress)) < 1e-9);
});

test('adds damping only when an outlier velocity could overshoot the remaining travel', () => {
  const ordinaryFastFlick = resolveNowPlayingDismissSpring(10_000, 760);
  const outlierFlick = resolveNowPlayingDismissSpring(50_000, 760);
  const outlierNearBottom = resolveNowPlayingDismissSpring(50_000, 400);

  assert.ok(ordinaryFastFlick.damping < 60);
  assert.equal(outlierFlick.velocity, 50_000);
  assert.ok(outlierFlick.damping > 60);
  assert.ok(outlierNearBottom.damping > outlierFlick.damping);
});

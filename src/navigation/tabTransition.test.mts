import assert from 'node:assert/strict';
import test from 'node:test';
import {
  TAB_SCENE_ANIMATION,
  TAB_TRANSITION_SETTLE_MS,
  TAB_TRANSITION_SPEC,
} from './tabTransition.ts';

test('tab scenes use a cross-fade and retain the short settle guard', () => {
  assert.equal(TAB_SCENE_ANIMATION, 'fade');
  assert.equal(TAB_TRANSITION_SETTLE_MS, 160);
});

test('tab fade uses a critically damped native spring with no overshoot', () => {
  assert.equal(TAB_TRANSITION_SPEC.animation, 'spring');
  assert.equal(TAB_TRANSITION_SPEC.config.overshootClamping, true);
  const criticalDamping =
    2 * Math.sqrt(TAB_TRANSITION_SPEC.config.stiffness * TAB_TRANSITION_SPEC.config.mass);
  assert.equal(TAB_TRANSITION_SPEC.config.damping, criticalDamping);
});

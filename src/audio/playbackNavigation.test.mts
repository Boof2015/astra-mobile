import assert from 'node:assert/strict';
import test from 'node:test';
import {
  PREVIOUS_RESTART_THRESHOLD_SECONDS,
  shouldRestartOnPrevious,
} from './playbackNavigation.ts';

test('restarts only after crossing the three-second threshold', () => {
  assert.equal(shouldRestartOnPrevious(3.001), true);
  assert.equal(shouldRestartOnPrevious(PREVIOUS_RESTART_THRESHOLD_SECONDS), false);
  assert.equal(shouldRestartOnPrevious(0), false);
});

test('invalid and negative positions retain previous-track behavior', () => {
  assert.equal(shouldRestartOnPrevious(-1), false);
  assert.equal(shouldRestartOnPrevious(Number.NaN), false);
  assert.equal(shouldRestartOnPrevious(Number.POSITIVE_INFINITY), false);
});

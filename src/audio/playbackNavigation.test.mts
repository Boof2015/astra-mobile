import assert from 'node:assert/strict';
import test from 'node:test';
import {
  PREVIOUS_RESTART_THRESHOLD_SECONDS,
  shouldResumeAfterExplicitNext,
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

test('only a paused explicit Next intent resumes playback', () => {
  assert.equal(shouldResumeAfterExplicitNext('paused'), true);
  assert.equal(shouldResumeAfterExplicitNext('playing'), false);
  assert.equal(shouldResumeAfterExplicitNext('loading'), false);
  assert.equal(shouldResumeAfterExplicitNext('stopped'), false);
});

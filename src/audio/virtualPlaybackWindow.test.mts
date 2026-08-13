import assert from 'node:assert/strict';
import test from 'node:test';
import {
  VIRTUAL_PLAYBACK_APPEND_BATCH,
  VIRTUAL_PLAYBACK_HISTORY,
  VIRTUAL_PLAYBACK_REFILL_THRESHOLD,
  VIRTUAL_PLAYBACK_UPCOMING,
  VIRTUAL_PLAYBACK_WINDOW_SIZE,
  shouldRefillVirtualPlayback,
  virtualPlaybackRefillLimit,
  virtualPlaybackTrimCount,
  virtualPlaybackWindowStart,
} from './virtualPlaybackWindow.ts';

test('uses the 8 history + current + 32 upcoming transport window', () => {
  assert.equal(VIRTUAL_PLAYBACK_HISTORY, 8);
  assert.equal(VIRTUAL_PLAYBACK_UPCOMING, 32);
  assert.equal(VIRTUAL_PLAYBACK_WINDOW_SIZE, 41);
  assert.equal(VIRTUAL_PLAYBACK_APPEND_BATCH, 8);
  assert.equal(virtualPlaybackWindowStart(8), 0);
  assert.equal(virtualPlaybackWindowStart(40), 32);
});

test('trims history without changing the logical queue position', () => {
  assert.equal(virtualPlaybackTrimCount(8), 0);
  assert.equal(virtualPlaybackTrimCount(9), 1);
  assert.equal(virtualPlaybackTrimCount(20), 12);
});

test('refills only below sixteen upcoming and caps coverage at thirty-two', () => {
  assert.equal(VIRTUAL_PLAYBACK_REFILL_THRESHOLD, 16);
  assert.equal(shouldRefillVirtualPlayback(16, 100, 200), false);
  assert.equal(shouldRefillVirtualPlayback(15, 100, 200), true);
  assert.equal(shouldRefillVirtualPlayback(0, 200, 200), false);
  assert.equal(virtualPlaybackRefillLimit(15, 100, 200), 17);
  assert.equal(virtualPlaybackRefillLimit(0, 190, 200), 10);
  assert.equal(virtualPlaybackRefillLimit(31, 199, 200), 1);
  assert.equal(virtualPlaybackRefillLimit(0, 200, 200), 0);
});

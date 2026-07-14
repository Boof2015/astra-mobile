import assert from 'node:assert/strict';
import test from 'node:test';
import {
  formatSleepTimerStatus,
  getSleepTimerRemainingMs,
  normalizePersistedSleepTimer,
  normalizeSleepTimerMinutes,
  shouldCompleteEndOfTrackTimer,
  transitionSleepTimer,
} from './sleepTimerState.ts';

test('sleep timer accepts presets and custom whole minutes from 1 through 720', () => {
  for (const value of [1, 15, 30, 45, 60, 720, '90']) {
    assert.equal(normalizeSleepTimerMinutes(value), Number(value));
  }
  for (const value of [0, 721, 1.5, '', 'nope']) assert.equal(normalizeSleepTimerMinutes(value), null);
});

test('minute timers use an absolute wall-clock deadline', () => {
  const timer = normalizePersistedSleepTimer({
    mode: 'minutes', startedAtMs: 1_000, expiresAtMs: 61_000, durationMinutes: 1,
  });
  assert.ok(timer);
  assert.equal(getSleepTimerRemainingMs(timer, 31_000), 30_000);
  assert.equal(getSleepTimerRemainingMs(timer, 80_000), 0);
  assert.equal(formatSleepTimerStatus(timer, 31_000), '0:30 remaining');
});

test('stale or corrupt persisted timers are rejected while end-of-track is normalized', () => {
  assert.equal(normalizePersistedSleepTimer({ mode: 'minutes', startedAtMs: 0, expiresAtMs: 1, durationMinutes: 0 }), null);
  assert.equal(normalizePersistedSleepTimer({ mode: 'unknown' }), null);
  assert.deepEqual(normalizePersistedSleepTimer({ mode: 'end-of-track', startedAtMs: 10, expiresAtMs: 50 }), {
    mode: 'end-of-track', startedAtMs: 10, expiresAtMs: null, durationMinutes: null,
  });
});

test('starting replaces an active timer and cancellation clears it', () => {
  const first = transitionSleepTimer(null, { type: 'start-minutes', minutes: 15 }, 1_000);
  const replacement = transitionSleepTimer(first, { type: 'start-minutes', minutes: 45 }, 5_000);
  assert.equal(replacement?.durationMinutes, 45);
  assert.equal(replacement?.expiresAtMs, 2_705_000);
  assert.equal(transitionSleepTimer(replacement, { type: 'cancel' }, 6_000), null);
});

test('end-of-track completes only after native playback pauses at the boundary', () => {
  const timer = transitionSleepTimer(null, { type: 'start-end-of-track' }, 1_000);
  assert.equal(shouldCompleteEndOfTrackTimer(timer, 99.8, 100, true), false);
  assert.equal(shouldCompleteEndOfTrackTimer(timer, 50, 100, false), false);
  assert.equal(shouldCompleteEndOfTrackTimer(timer, 99.8, 100, false), true);
});

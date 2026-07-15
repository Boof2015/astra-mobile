import assert from 'node:assert/strict';
import test from 'node:test';
import {
  applyPlaybackSnapshot,
  createPlaybackClock,
  projectPlaybackClock,
  setPlaybackClockRunning,
} from './playbackClock.ts';

test('projects elapsed time only while playback is running', () => {
  const clock = createPlaybackClock(10, 120, true, 1_000);
  assert.equal(projectPlaybackClock(clock, 120, 2_500), 11.5);
});

test('freezes on pause and excludes a long paused interval on resume', () => {
  const playing = createPlaybackClock(10, 120, true, 1_000);
  const paused = setPlaybackClockRunning(playing, false, 120, 2_500);

  assert.equal(projectPlaybackClock(paused, 120, 62_500), 11.5);

  const resumed = setPlaybackClockRunning(paused, true, 120, 62_500);
  assert.equal(projectPlaybackClock(resumed, 120, 63_500), 12.5);
});

test('accepts authoritative progress snapshots while playing or paused', () => {
  const playing = createPlaybackClock(10, 120, true, 1_000);
  const sought = applyPlaybackSnapshot(playing, 75, 120, 2_000);
  assert.equal(projectPlaybackClock(sought, 120, 2_500), 75.5);

  const paused = setPlaybackClockRunning(sought, false, 120, 2_500);
  const pausedSeek = applyPlaybackSnapshot(paused, 25, 120, 50_000);
  assert.equal(projectPlaybackClock(pausedSeek, 120, 90_000), 25);
});

test('clamps projections and duration changes to valid track bounds', () => {
  const nearEnd = createPlaybackClock(119, 120, true, 1_000);
  assert.equal(projectPlaybackClock(nearEnd, 120, 10_000), 120);
  assert.equal(projectPlaybackClock(nearEnd, 60, 10_000), 60);

  const invalid = applyPlaybackSnapshot(nearEnd, Number.NaN, 120, 10_000);
  assert.equal(projectPlaybackClock(invalid, 120, 10_000), 0);
});

test('a track reset replaces the previous interpolation anchor', () => {
  const previousTrack = createPlaybackClock(80, 240, true, 1_000);
  const nextTrack = applyPlaybackSnapshot(previousTrack, 0, 180, 5_000);
  assert.equal(projectPlaybackClock(nextTrack, 180, 5_500), 0.5);
});

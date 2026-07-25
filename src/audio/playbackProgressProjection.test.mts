import assert from 'node:assert/strict';
import test from 'node:test';
import {
  clampPlaybackFraction,
  reconcilePlaybackProgress,
} from './playbackProgressProjection.ts';

test('playing snapshots animate linearly from the reconciled position', () => {
  const command = reconcilePlaybackProgress({
    currentTime: 25,
    duration: 100,
    isPlaying: true,
    active: true,
    trackKey: 'a',
  });
  assert.deepEqual(command, {
    fraction: 0.25,
    animate: true,
    animationDurationMs: 75_000,
    trackChanged: false,
  });
});

test('pause snaps immediately and schedules no projection', () => {
  const command = reconcilePlaybackProgress({
    currentTime: 25,
    duration: 100,
    isPlaying: false,
    active: true,
  });
  assert.equal(command.fraction, 0.25);
  assert.equal(command.animate, false);
  assert.equal(command.animationDurationMs, 0);
});

test('scrub and pending-seek overrides take precedence over stale live time', () => {
  const command = reconcilePlaybackProgress({
    currentTime: 10,
    duration: 100,
    isPlaying: true,
    active: true,
    overrideFraction: 0.8,
  });
  assert.equal(command.fraction, 0.8);
  assert.equal(command.animate, false);
});

test('duration changes reconcile the fraction and remaining animation time', () => {
  const command = reconcilePlaybackProgress({
    currentTime: 50,
    duration: 200,
    isPlaying: true,
    active: true,
  });
  assert.equal(command.fraction, 0.25);
  assert.equal(command.animationDurationMs, 150_000);
});

test('track changes are identified and snap to the new track snapshot', () => {
  const command = reconcilePlaybackProgress(
    {
      currentTime: 2,
      duration: 80,
      isPlaying: true,
      active: true,
      trackKey: 'new',
    },
    'old'
  );
  assert.equal(command.trackChanged, true);
  assert.equal(command.fraction, 0.025);
});

test('hidden surfaces and invalid values are pinned without animation', () => {
  const command = reconcilePlaybackProgress({
    currentTime: 10,
    duration: 100,
    isPlaying: true,
    active: false,
  });
  assert.equal(command.animate, false);
  assert.equal(clampPlaybackFraction(Number.NaN), 0);
  assert.equal(clampPlaybackFraction(2), 1);
});

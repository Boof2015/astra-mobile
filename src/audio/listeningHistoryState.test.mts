import assert from 'node:assert/strict';
import test from 'node:test';
import {
  listenedTickDeltaMs,
  listeningCheckpointDue,
  playbackAppearsNaturallyCompleted,
} from './listeningHistoryState.ts';

test('counts wall-clock time only while actively playing', () => {
  assert.equal(listenedTickDeltaMs(1_000, 2_000, true), 1_000);
  assert.equal(listenedTickDeltaMs(1_000, 2_000, false), 0);
  assert.equal(listenedTickDeltaMs(null, 2_000, true), 0);
});

test('counts background event stalls and ignores backwards clocks', () => {
  assert.equal(listenedTickDeltaMs(1_000, 30_000, true), 29_000);
  assert.equal(listenedTickDeltaMs(2_000, 1_000, true), 0);
});

test('checkpoints every ten seconds and at the qualification boundary', () => {
  assert.equal(listeningCheckpointDue({
    listenedSeconds: 9.99,
    lastCheckpointSeconds: 0,
    qualificationCheckpointSent: false,
    durationSeconds: 180,
  }), false);
  assert.equal(listeningCheckpointDue({
    listenedSeconds: 10,
    lastCheckpointSeconds: 0,
    qualificationCheckpointSent: false,
    durationSeconds: 180,
  }), true);
  assert.equal(listeningCheckpointDue({
    listenedSeconds: 15,
    lastCheckpointSeconds: 10,
    qualificationCheckpointSent: false,
    durationSeconds: 180,
  }), true);
  assert.equal(listeningCheckpointDue({
    listenedSeconds: 15,
    lastCheckpointSeconds: 15,
    qualificationCheckpointSent: true,
    durationSeconds: 180,
  }), false);
});

test('natural completion requires the final native position', () => {
  assert.equal(playbackAppearsNaturallyCompleted(5, 4), true);
  assert.equal(playbackAppearsNaturallyCompleted(5, 3.99), false);
  assert.equal(playbackAppearsNaturallyCompleted(180, 15), false);
  assert.equal(playbackAppearsNaturallyCompleted(0, 0), false);
});

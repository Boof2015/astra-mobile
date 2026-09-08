import assert from 'node:assert/strict';
import test from 'node:test';
import { applyCarResume } from './carResumeState.ts';
import type { PlaybackSessionSnapshotV1 } from './sessionState.ts';

const session: PlaybackSessionSnapshotV1 = {
  queuePaths: ['a', 'b', 'a'], originalOrderPaths: ['a', 'b', 'a'],
  activeIndex: 0, position: 4, shuffle: false, repeat: 'none',
};
const resume = { path: 'a', queuePosition: 2, position: 12, shuffle: true, repeat: 'all' as const, savedAt: 20 };

test('a newer native resume card restores the actual duplicate occurrence and modes', () => {
  const restored = applyCarResume(session, 10, resume);
  assert.equal(restored.activeIndex, 2);
  assert.equal(restored.position, 12);
  assert.equal(restored.repeat, 'all');
  assert.equal(restored.shuffle, true);
  assert.deepEqual(restored.queuePaths, session.queuePaths);
});

test('an automatic transition advances beyond the stale JavaScript active index', () => {
  assert.equal(applyCarResume(session, 10, { ...resume, path: 'b', queuePosition: 1 }).activeIndex, 1);
});

test('a newer phone session wins over an older car card', () => {
  assert.equal(applyCarResume(session, 30, resume), session);
  assert.equal(applyCarResume(session, 10, null), session);
});

test('a changed or ambiguous runtime queue restores the known song without choosing a different row', () => {
  assert.deepEqual(applyCarResume(session, 10, { ...resume, path: 'new' }).queuePaths, ['new']);
  assert.deepEqual(applyCarResume(session, 10, { ...resume, queuePosition: 1 }).queuePaths, ['a']);
  assert.equal(applyCarResume(session, 10, { ...resume, path: 'b', queuePosition: 8 }).activeIndex, 1);
});

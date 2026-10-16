import assert from 'node:assert/strict';
import test from 'node:test';
import { advanceArtTransition, canReleaseArtSlot, type ArtTransition } from './nowPlayingArtTransition.ts';

const initial: ArtTransition = { key: 'a', previousKey: null, direction: 1, front: 0, generation: 0 };

test('metadata/artwork resolving on the same track does not start another slide', () => {
  assert.equal(advanceArtTransition(initial, 'a', -1), initial);
});

test('next then previous, including a failed predicted swipe, reverses the interrupted slide', () => {
  const next = advanceArtTransition(initial, 'b', 1);
  const back = advanceArtTransition(next, 'a', 1);
  assert.equal(back.direction, -1);
  assert.equal(back.front, 0);
  assert.equal(back.generation, 2);
  assert.equal(canReleaseArtSlot(back, 0, next.generation), false);
  assert.equal(canReleaseArtSlot(back, 1, back.generation), true);
});

test('rapid skips cannot let an old completion release a reused or visible slot', () => {
  const next = advanceArtTransition(initial, 'b', 1);
  const third = advanceArtTransition(next, 'c', 1);
  const fourth = advanceArtTransition(third, 'd', 1);
  assert.equal(canReleaseArtSlot(fourth, 0, next.generation), false);
  assert.equal(canReleaseArtSlot(fourth, 1, third.generation), false);
  assert.equal(canReleaseArtSlot(fourth, fourth.front, fourth.generation), false);
  assert.equal(canReleaseArtSlot(fourth, 1 - fourth.front, fourth.generation), true);
});

test('an unrelated previous track follows transport intent and clearing a track advances safely', () => {
  const previous = advanceArtTransition(initial, 'z', -1);
  assert.equal(previous.direction, -1);
  const cleared = advanceArtTransition(previous, null, 1);
  assert.equal(cleared.key, null);
  assert.equal(cleared.front, initial.front);
  assert.equal(cleared.generation, 2);
});

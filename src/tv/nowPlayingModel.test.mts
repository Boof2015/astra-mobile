import test from 'node:test';
import assert from 'node:assert/strict';
import { canPlayerIdle, playerNeighbor, seekPreview } from './nowPlayingModel.ts';
import { queueEntryKey, queueMoveTarget } from './playerQueueModel.ts';

test('cover routes follow control geometry and stop at the edges', () => {
  assert.equal(playerNeighbor('play', 'right', false), 'seek');
  assert.equal(playerNeighbor('favorite', 'down', false), 'seek');
  assert.equal(playerNeighbor('play', 'down', false), 'previous');
  assert.equal(playerNeighbor('previous', 'up', false), 'play');
  for (const item of ['next', 'shuffle', 'repeat', 'lyrics', 'queue', 'more'] as const) assert.equal(playerNeighbor(item, 'up', false), 'seek');
  assert.equal(playerNeighbor('seek', 'down', false, 'queue'), 'queue');
  assert.equal(playerNeighbor('more', 'right', false), 'more');
  assert.equal(playerNeighbor('previous', 'left', false), 'previous');
});

test('lyrics layout stacks transport and pills with explicit vertical routes', () => {
  assert.equal(playerNeighbor('previous', 'down', true), 'lyrics');
  assert.equal(playerNeighbor('next', 'down', true), 'lyrics');
  assert.equal(playerNeighbor('shuffle', 'down', true), 'queue');
  assert.equal(playerNeighbor('repeat', 'down', true), 'queue');
  assert.equal(playerNeighbor('lyrics', 'up', true), 'next');
  assert.equal(playerNeighbor('queue', 'up', true), 'repeat');
  assert.equal(playerNeighbor('more', 'up', true), 'repeat');
  assert.equal(playerNeighbor('seek', 'down', true, 'more'), 'shuffle');
  assert.equal(playerNeighbor('repeat', 'right', true), 'repeat');
  assert.equal(playerNeighbor('lyrics', 'left', true), 'lyrics');
});

test('seek preview clamps, accelerates real held repeats and never affects playback state', () => {
  assert.equal(seekPreview(2, 240, 'left'), 0);
  assert.equal(seekPreview(236, 240, 'right'), 239);
  assert.equal(seekPreview(20, 240, 'right', 800, true), 35);
  assert.equal(seekPreview(20, 240, 'right', 800, false), 25);
  assert.equal(seekPreview(20, 240, 'right', 100, true), 25);
  assert.equal(seekPreview(0, 0, 'right'), 0);
});

test('idle is disallowed while paused, backgrounded, seeking or using a panel', () => {
  assert.equal(canPlayerIdle(true, true, false, false), true);
  assert.equal(canPlayerIdle(false, true, false, false), false);
  assert.equal(canPlayerIdle(true, false, false, false), false);
  assert.equal(canPlayerIdle(true, true, true, false), false);
  assert.equal(canPlayerIdle(true, true, false, true), false);
});

test('queue identities distinguish duplicate occurrences and survive reorder or window changes', () => {
  const base = { id: 'same-song', url: 'same-file', astraQueueSessionId: 'library:1' };
  const first = { ...base, astraQueueEntryId: 8 };
  const second = { ...base, astraQueueEntryId: 9 };
  assert.notEqual(queueEntryKey(first), queueEntryKey(second));
  assert.equal(queueEntryKey(first), queueEntryKey({ ...first, astraCarQueueEntryId: 'new-transport-id' }));
  assert.notEqual(queueEntryKey({ ...first, astraQueueSessionId: 'library:2' }), queueEntryKey(first));
  const legacy1 = { id: 'same', url: 'same' }, legacy2 = { ...legacy1 };
  assert.equal(queueEntryKey(legacy1), queueEntryKey(legacy1));
  assert.notEqual(queueEntryKey(legacy1), queueEntryKey(legacy2));
});

test('queue moves never cross the playing track and use full queue positions', () => {
  assert.equal(queueMoveTarget(49, -1, 48, 400), 49);
  assert.equal(queueMoveTarget(48, 1, 48, 400), 48);
  assert.equal(queueMoveTarget(140, 1, 48, 400), 141);
  assert.equal(queueMoveTarget(399, 1, 48, 400), 399);
});

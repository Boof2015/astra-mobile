import assert from 'node:assert/strict';
import test from 'node:test';
import {
  indexQueueEntriesByKey,
  moveQueueEntry,
  removeQueueEntryAt,
  resolveSelectedQueueAction,
  type KeyedQueueEntry,
} from './queueActions.ts';

function keyed(keys: string[]): KeyedQueueEntry[] {
  return keys.map((key) => ({ key }));
}

function entryKeys(entries: readonly KeyedQueueEntry[]): string[] {
  return entries.map((entry) => entry.key);
}

interface PositionedQueueEntry extends KeyedQueueEntry {
  absoluteIndex: number;
}

function positioned(keys: string[], baseOffset: number): PositionedQueueEntry[] {
  return keys.map((key, index) => ({ key, absoluteIndex: baseOffset + index }));
}

test('resolves each drag from the latest keyed queue order', () => {
  let upcoming = keyed(['A', 'B', 'C', 'D']);

  let currentIndices = indexQueueEntriesByKey(upcoming);
  upcoming = moveQueueEntry(upcoming, currentIndices.B, 3);
  assert.deepEqual(entryKeys(upcoming), ['A', 'C', 'D', 'B']);

  currentIndices = indexQueueEntriesByKey(upcoming);
  assert.equal(currentIndices.B, 3);
  upcoming = moveQueueEntry(upcoming, currentIndices.B, 1);
  assert.deepEqual(entryKeys(upcoming), ['A', 'B', 'C', 'D']);
});

test('resolves first, middle, and last swipe removals from the pre-mutation order', () => {
  const scenarios = [
    { localIndex: 0, absoluteIndex: 7, remaining: ['B', 'C'] },
    { localIndex: 1, absoluteIndex: 8, remaining: ['A', 'C'] },
    { localIndex: 2, absoluteIndex: 9, remaining: ['A', 'B'] },
  ];

  for (const scenario of scenarios) {
    const action = removeQueueEntryAt(keyed(['A', 'B', 'C']), scenario.localIndex, 7);
    if (!action) throw new Error('expected a remove action');

    assert.equal(action.absoluteIndex, scenario.absoluteIndex);
    assert.deepEqual(entryKeys(action.nextEntries), scenario.remaining);
  }
});

test('keeps the swiped remove index after the optimistic ref changes to the next order', () => {
  let entriesRef = positioned(['A', 'B', 'C'], 1);
  const localIndex = entriesRef.findIndex((entry) => entry.key === 'B');
  const action = removeQueueEntryAt(entriesRef, localIndex, 1);

  if (!action) throw new Error('expected a remove action');
  entriesRef = action.nextEntries;

  assert.equal(action.absoluteIndex, 2);
  assert.deepEqual(entryKeys(entriesRef), ['A', 'C']);
  // Looking up localIndex after the optimistic update would incorrectly select C.
  assert.equal(entriesRef[localIndex].absoluteIndex, 3);
});

test('removes duplicate tracks by unique row key and preserves the other occurrence', () => {
  const upcoming = keyed(['same-track:0', 'same-track:1', 'tail']);
  const action = removeQueueEntryAt(upcoming, 1, 20);

  if (!action) throw new Error('expected a remove action');
  assert.equal(action.absoluteIndex, 21);
  assert.deepEqual(entryKeys(action.nextEntries), ['same-track:0', 'tail']);
});

test('uses the loaded virtual-page offset for swipe removal', () => {
  const action = removeQueueEntryAt(keyed(['V500', 'V501', 'V502']), 2, 500);

  if (!action) throw new Error('expected a remove action');
  assert.equal(action.absoluteIndex, 502);
  assert.deepEqual(entryKeys(action.nextEntries), ['V500', 'V501']);
});

test('re-resolves consecutive removals against each optimistic order', () => {
  let upcoming = keyed(['A', 'B', 'C', 'D']);

  const first = removeQueueEntryAt(upcoming, 1, 10);
  if (!first) throw new Error('expected the first remove action');
  upcoming = first.nextEntries;

  const second = removeQueueEntryAt(upcoming, 1, 10);
  if (!second) throw new Error('expected the second remove action');
  upcoming = second.nextEntries;

  assert.equal(first.absoluteIndex, 11);
  assert.equal(second.absoluteIndex, 11);
  assert.deepEqual(entryKeys(upcoming), ['A', 'D']);
});

test('captures play-next absolute index before optimistic reordering', () => {
  let entriesRef = positioned(['A', 'B', 'C'], 40);
  const snapshot = entriesRef;
  const localIndex = snapshot.findIndex((entry) => entry.key === 'C');
  const absoluteIndex = snapshot[localIndex].absoluteIndex;

  entriesRef = moveQueueEntry(snapshot, localIndex, 0);

  assert.equal(absoluteIndex, 42);
  assert.deepEqual(entryKeys(entriesRef), ['C', 'A', 'B']);
  // Looking up localIndex after the optimistic update would incorrectly select B.
  assert.equal(entriesRef[localIndex].absoluteIndex, 41);
});

test('captures selected absolute indices before optimistic batch mutation', () => {
  const upcoming = keyed(['A', 'B', 'C', 'D']);
  const selectedKeys = new Set(['B', 'D']);
  const action = resolveSelectedQueueAction(upcoming, selectedKeys, 1);

  assert.deepEqual(action.absoluteIndices, [2, 4]);
  assert.deepEqual(entryKeys(action.entriesWithoutSelected), ['A', 'C']);
  assert.deepEqual(entryKeys(action.entriesWithSelectedFirst), ['B', 'D', 'A', 'C']);

  const afterOptimisticRemoval = resolveSelectedQueueAction(
    action.entriesWithoutSelected,
    selectedKeys,
    1
  );
  assert.deepEqual(afterOptimisticRemoval.absoluteIndices, []);
});

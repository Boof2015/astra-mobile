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

test('resolves swipe remove before the optimistic mirror mutation', () => {
  const upcoming = keyed(['A', 'B', 'C']);
  const action = removeQueueEntryAt(upcoming, 1, 1);

  if (!action) throw new Error('expected a remove action');
  assert.equal(action.absoluteIndex, 2);
  assert.deepEqual(entryKeys(action.nextEntries), ['A', 'C']);

  const mirrorAfterNativeCompletionWithSkippedUpdate = action.nextEntries;
  assert.deepEqual(entryKeys(mirrorAfterNativeCompletionWithSkippedUpdate), ['A', 'C']);
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

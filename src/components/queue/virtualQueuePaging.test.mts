import assert from 'node:assert/strict';
import test from 'node:test';
import {
  VIRTUAL_QUEUE_PAGE_SIZE,
  VIRTUAL_QUEUE_PREFETCH_ROWS,
  isCurrentVirtualQueueRequest,
  isVirtualQueueWaitingForTracks,
  mergeVirtualQueueTracks,
  nextVirtualQueuePageStart,
  seedVirtualQueueTracks,
  shouldPrefetchVirtualQueue,
} from './virtualQueuePaging.ts';

interface TestTrack {
  id: string;
  astraQueuePosition: number;
}

function tracks(start: number, count: number): TestTrack[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `track-${start + index}`,
    astraQueuePosition: start + index,
  }));
}

test('seeds the tray from the already-loaded playback window after the active row', () => {
  assert.deepEqual(
    seedVirtualQueueTracks(tracks(20, 8), 22, 27).map((track) => track.astraQueuePosition),
    [23, 24, 25, 26],
  );
});

test('merges sequential virtual pages without dropping earlier tray rows', () => {
  const first = tracks(1, VIRTUAL_QUEUE_PAGE_SIZE);
  const second = tracks(VIRTUAL_QUEUE_PAGE_SIZE + 1, VIRTUAL_QUEUE_PAGE_SIZE);
  const third = tracks(VIRTUAL_QUEUE_PAGE_SIZE * 2 + 1, VIRTUAL_QUEUE_PAGE_SIZE);
  const merged = mergeVirtualQueueTracks(
    mergeVirtualQueueTracks(first, second),
    third,
  );

  assert.equal(merged.length, VIRTUAL_QUEUE_PAGE_SIZE * 3);
  assert.equal(merged[0], first[0]);
  assert.equal(merged.at(-1), third.at(-1));
});

test('deduplicates overlapping page boundaries and keeps existing row identity', () => {
  const first = tracks(1, 3);
  const duplicate = { id: 'replacement', astraQueuePosition: 3 };
  const merged = mergeVirtualQueueTracks(first, [duplicate, ...tracks(4, 2)]);

  assert.deepEqual(merged.map((track) => track.astraQueuePosition), [1, 2, 3, 4, 5]);
  assert.equal(merged[2], first[2]);
});

test('prefetches one hundred rows before the loaded end', () => {
  assert.equal(VIRTUAL_QUEUE_PREFETCH_ROWS, 100);
  assert.equal(shouldPrefetchVirtualQueue(399, 500, true), false);
  assert.equal(shouldPrefetchVirtualQueue(400, 500, true), true);
  assert.equal(shouldPrefetchVirtualQueue(499, 500, false), false);
});

test('stops paging at the virtual queue end', () => {
  assert.equal(nextVirtualQueuePageStart(tracks(1, 4), 0, 6), 5);
  assert.equal(nextVirtualQueuePageStart(tracks(1, 5), 0, 6), null);
  assert.equal(nextVirtualQueuePageStart([], 5, 6), null);
});

test('loads an empty virtual seed immediately when tracks remain', () => {
  assert.equal(isVirtualQueueWaitingForTracks(0, 5, 10), true);
  assert.equal(isVirtualQueueWaitingForTracks(1, 5, 10), false);
  assert.equal(isVirtualQueueWaitingForTracks(0, 9, 10), false);
});

test('rejects stale generations and replaced playback sessions', () => {
  assert.equal(isCurrentVirtualQueueRequest(4, 4, 'session-a', 'session-a'), true);
  assert.equal(isCurrentVirtualQueueRequest(3, 4, 'session-a', 'session-a'), false);
  assert.equal(isCurrentVirtualQueueRequest(4, 4, 'session-a', 'session-b'), false);
  assert.equal(isCurrentVirtualQueueRequest(4, 4, 'session-a', undefined), false);
});

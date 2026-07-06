import assert from 'node:assert/strict';
import test from 'node:test';
import {
  mergePlaylistEntries,
  playlistEntriesEqual,
} from './desktopSyncPlaylistMerge.ts';
import type { SyncPlaylistEntry } from '../types/desktopSync.ts';

function entry(title: string, position: number, overrides: Partial<SyncPlaylistEntry> = {}): SyncPlaylistEntry {
  return {
    title,
    artist: 'Artist',
    album: 'Album',
    durationSeconds: 200,
    position,
    addedAt: 1_000 + position,
    sourcePath: null,
    ...overrides,
  };
}

test('equal contents in the same order compare equal despite case/whitespace', () => {
  const a = [entry('One', 0), entry('Two', 1)];
  const b = [entry(' one ', 0), entry('TWO', 1)];
  assert.equal(playlistEntriesEqual(a, b), true);
});

test('same songs in a different order are NOT equal (order is content)', () => {
  const a = [entry('One', 0), entry('Two', 1)];
  const b = [entry('Two', 0), entry('One', 1)];
  assert.equal(playlistEntriesEqual(a, b), false);
});

test('different lengths are not equal', () => {
  assert.equal(playlistEntriesEqual([entry('One', 0)], []), false);
});

test('merge keeps the newer order first and appends the older side extras', () => {
  const newer = [entry('A', 0), entry('B', 1), entry('C', 2)];
  const older = [entry('B', 0), entry('X', 1), entry('A', 2), entry('Y', 3)];
  const merged = mergePlaylistEntries(newer, older);
  assert.deepEqual(
    merged.map((e) => e.title),
    ['A', 'B', 'C', 'X', 'Y']
  );
  assert.deepEqual(
    merged.map((e) => e.position),
    [0, 1, 2, 3, 4]
  );
});

test('merged entries keep their origin metadata', () => {
  const newer = [entry('A', 0, { addedAt: 111 })];
  const older = [entry('Z', 0, { addedAt: 999, sourcePath: 'D:/z.flac' })];
  const merged = mergePlaylistEntries(newer, older);
  assert.equal(merged[1].addedAt, 999);
  assert.equal(merged[1].sourcePath, 'D:/z.flac');
});

test('merge respects stored positions, not array order', () => {
  const newer = [entry('B', 1), entry('A', 0)];
  const merged = mergePlaylistEntries(newer, []);
  assert.deepEqual(
    merged.map((e) => e.title),
    ['A', 'B']
  );
});

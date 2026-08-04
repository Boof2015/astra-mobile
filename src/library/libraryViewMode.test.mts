import assert from 'node:assert/strict';
import test from 'node:test';
import {
  LIBRARY_VIEW_MODES,
  libraryViewModeDirection,
  resolveLibraryViewModeTransition,
} from './libraryViewMode.ts';

test('Library mode direction follows the visible selector order', () => {
  assert.deepEqual(
    LIBRARY_VIEW_MODES.map((entry) => entry.key),
    ['albums', 'artists', 'tracks', 'playlists', 'folders']
  );
  assert.equal(libraryViewModeDirection('albums', 'artists'), 1);
  assert.equal(libraryViewModeDirection('artists', 'folders'), 1);
  assert.equal(libraryViewModeDirection('folders', 'playlists'), -1);
  assert.equal(libraryViewModeDirection('tracks', 'albums'), -1);
  assert.equal(libraryViewModeDirection('tracks', 'tracks'), 0);
});

test('rapid requests collapse to the newest destination rather than queueing', () => {
  let pending = resolveLibraryViewModeTransition('albums', 'artists', false);
  pending = resolveLibraryViewModeTransition('albums', 'tracks', false);
  pending = resolveLibraryViewModeTransition('albums', 'folders', false);

  assert.deepEqual(pending, { mode: 'folders', direction: 1, animated: true });
  assert.deepEqual(resolveLibraryViewModeTransition('albums', 'albums', false), {
    mode: 'albums',
    direction: 0,
    animated: false,
  });
});

test('Reduced Motion cuts directly to the requested Library mode', () => {
  assert.deepEqual(resolveLibraryViewModeTransition('folders', 'albums', true), {
    mode: 'albums',
    direction: -1,
    animated: false,
  });
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { needsWindowRewind, type LibraryWindowCursors } from './libraryWindowTop.ts';

const atHead: LibraryWindowCursors = {
  trackPrevCursor: null,
  albumPrevCursor: null,
  artistPrevCursor: null,
};

test('a window starting at the head of the catalog only needs scrolling', () => {
  assert.equal(needsWindowRewind('tracks', atHead), false);
  assert.equal(needsWindowRewind('albums', atHead), false);
  assert.equal(needsWindowRewind('artists', atHead), false);
});

test('each view mode reads only its own backward cursor', () => {
  assert.equal(needsWindowRewind('tracks', { ...atHead, trackPrevCursor: 'cur' }), true);
  assert.equal(needsWindowRewind('albums', { ...atHead, trackPrevCursor: 'cur' }), false);
  assert.equal(needsWindowRewind('artists', { ...atHead, trackPrevCursor: 'cur' }), false);

  assert.equal(needsWindowRewind('albums', { ...atHead, albumPrevCursor: 'cur' }), true);
  assert.equal(needsWindowRewind('artists', { ...atHead, artistPrevCursor: 'cur' }), true);
});

test('the un-paged views never rebuild their window', () => {
  const jumped: LibraryWindowCursors = {
    trackPrevCursor: 'cur',
    albumPrevCursor: 'cur',
    artistPrevCursor: 'cur',
  };
  assert.equal(needsWindowRewind('playlists', jumped), false);
  assert.equal(needsWindowRewind('folders', jumped), false);
  assert.equal(needsWindowRewind('something-new', jumped), false);
});

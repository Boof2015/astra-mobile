import assert from 'node:assert/strict';
import test from 'node:test';
import {
  canPopWithinLibrary,
  libraryParentLabel,
  parentRoute,
} from './libraryDetailBack.ts';

const libraryRoot = { name: 'index' };
const artist = { name: 'artist/[name]', params: { name: 'Radiohead' } };
const album = { name: 'album/[key]', params: { key: 'abc123' } };

test('back from an album opened on an artist page returns to that artist', () => {
  // The bug this fixes: the old hook forced dismissTo('/library') here, so the
  // artist page was skipped entirely and you landed at the library root.
  const state = { index: 2, routes: [libraryRoot, artist, album] };
  assert.equal(canPopWithinLibrary(state), true);
  assert.deepEqual(parentRoute(state), artist);
  assert.equal(libraryParentLabel(parentRoute(state)), 'Radiohead');
});

test('back from an album opened off the library list returns to the library', () => {
  const state = { index: 1, routes: [libraryRoot, album] };
  assert.equal(canPopWithinLibrary(state), true);
  assert.equal(libraryParentLabel(parentRoute(state)), 'Library');
});

test('the library list itself has nothing to pop to', () => {
  const state = { index: 0, routes: [libraryRoot] };
  assert.equal(canPopWithinLibrary(state), false);
  assert.equal(parentRoute(state), undefined);
  assert.equal(libraryParentLabel(undefined), 'Library');
});

test('a stack entered straight at a detail screen reports no parent', () => {
  // The library layout anchors an `index` route to make this rare, but the hook
  // still needs the dismissTo fallback for it.
  const state = { index: 0, routes: [album] };
  assert.equal(canPopWithinLibrary(state), false);
  assert.equal(parentRoute(state), undefined);
});

test('artist sub-sections label with the artist, not a generic word', () => {
  // Library › artist › all albums › album — the parent is the sub-section route,
  // which still carries the artist name in its params.
  const albumsSection = { name: 'artist/[name]/albums', params: { name: 'Boards of Canada' } };
  const state = { index: 3, routes: [libraryRoot, artist, albumsSection, album] };
  assert.equal(libraryParentLabel(parentRoute(state)), 'Boards of Canada');
});

test('parents whose title needs a lookup fall back to their kind', () => {
  // Album and playlist titles are resolved asynchronously by key/id, so they are
  // not available from route params — label the kind rather than fetch for a label.
  assert.equal(libraryParentLabel(album), 'Album');
  assert.equal(libraryParentLabel({ name: 'playlist/[id]', params: { id: '7' } }), 'Playlist');
});

test('an artist route with no usable name degrades gracefully', () => {
  assert.equal(libraryParentLabel({ name: 'artist/[name]' }), 'Artist');
  assert.equal(libraryParentLabel({ name: 'artist/[name]', params: { name: '  ' } }), 'Artist');
  assert.equal(libraryParentLabel({ name: 'artist/[name]', params: { name: 42 } }), 'Artist');
});

test('walking artist → album → artist keeps each step honest', () => {
  // The chain the user flagged: every level names the screen it returns to, and
  // each back press moves exactly one step.
  const other = { name: 'artist/[name]', params: { name: 'Autechre' } };
  const chain = { index: 3, routes: [libraryRoot, artist, album, other] };
  assert.equal(libraryParentLabel(parentRoute(chain)), 'Album');
  assert.equal(libraryParentLabel(parentRoute({ index: 2, routes: chain.routes })), 'Radiohead');
  assert.equal(libraryParentLabel(parentRoute({ index: 1, routes: chain.routes })), 'Library');
});

test('a state without an explicit index falls back to the topmost route', () => {
  assert.equal(libraryParentLabel(parentRoute({ routes: [libraryRoot, artist, album] })), 'Radiohead');
  assert.equal(canPopWithinLibrary({ routes: [libraryRoot] }), false);
  assert.equal(canPopWithinLibrary({ routes: [] }), false);
  assert.equal(parentRoute(undefined), undefined);
});

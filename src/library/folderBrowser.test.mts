import assert from 'node:assert/strict';
import test from 'node:test';
import {
  currentFolderId,
  enterFolder,
  folderBrowserRows,
  leaveFolder,
} from './folderBrowser.ts';

interface Node {
  id: string;
  name: string;
}

interface Track {
  path: string;
}

function state(
  node: Node,
  childIds: string[] = [],
  tracks: Track[] = [],
  nextOffset: number | null = null,
) {
  return { node, childIds, tracks, nextOffset };
}

test('folder path enters children and leaves one directory at a time', () => {
  const root = enterFolder([], 'music');
  const nested = enterFolder(root, 'album');

  assert.deepEqual(root, ['music']);
  assert.deepEqual(nested, ['music', 'album']);
  assert.equal(currentFolderId(nested), 'album');
  assert.deepEqual(leaveFolder(nested), ['music']);
  assert.deepEqual(leaveFolder(root), []);
});

test('leaving the browser root falls through to normal navigation', () => {
  assert.equal(currentFolderId([]), null);
  assert.equal(leaveFolder([]), null);
});

test('browser root shows only configured library roots', () => {
  const nodes = new Map([
    ['music', state({ id: 'music', name: 'Music' })],
    ['other', state({ id: 'other', name: 'Other' })],
  ]);

  const rows = folderBrowserRows({
    path: [],
    rootIds: ['music', 'missing', 'other'],
    nodes,
    trackId: (track: Track) => track.path,
  });

  assert.deepEqual(rows.map((row) => [row.type, row.id]), [
    ['folder', 'music'],
    ['folder', 'other'],
  ]);
});

test('current directory orders parent, child folders, direct tracks, then pager', () => {
  const nodes = new Map([
    [
      'music',
      state(
        { id: 'music', name: 'Music' },
        ['album-a', 'album-b'],
        [{ path: '/music/one.flac' }, { path: '/music/two.flac' }],
        100,
      ),
    ],
    ['album-a', state({ id: 'album-a', name: 'Album A' })],
    ['album-b', state({ id: 'album-b', name: 'Album B' })],
  ]);

  const rows = folderBrowserRows({
    path: ['music'],
    rootIds: ['music'],
    nodes,
    trackId: (track: Track) => track.path,
  });

  assert.deepEqual(rows.map((row) => row.type), [
    'up',
    'folder',
    'folder',
    'track',
    'track',
    'more',
  ]);
  assert.equal(rows[0].id, 'folder-browser:up');
  assert.equal(rows.at(-1)?.type, 'more');
});

test('catalog reset is represented by an empty path and returns to root rows', () => {
  const nodes = new Map([
    ['music', state({ id: 'music', name: 'Music' }, ['album'])],
    ['album', state({ id: 'album', name: 'Album' })],
  ]);
  const previousPath = ['music', 'album'];
  const resetPath: string[] = [];

  assert.equal(currentFolderId(previousPath), 'album');
  assert.deepEqual(
    folderBrowserRows({
      path: resetPath,
      rootIds: ['music'],
      nodes,
      trackId: (track: Track) => track.path,
    }).map((row) => row.id),
    ['music'],
  );
});

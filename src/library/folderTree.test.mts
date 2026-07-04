import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildFolderTree,
  decodedSafDocumentPath,
  decodedSafTreePath,
  flattenFolderTree,
} from './folderTree.ts';
import type { DbTrack, LibraryFolder } from '@/types/library';

function folder(overrides: Partial<LibraryFolder> = {}): LibraryFolder {
  return {
    id: 1,
    tree_uri: 'content://com.android.externalstorage.documents/tree/primary%3AMusic%2FAstraTest',
    display_name: 'AstraTest',
    added_at: 1,
    last_scanned_at: 2,
    available: true,
    ...overrides,
  };
}

function track(overrides: Partial<DbTrack> = {}): DbTrack {
  return {
    id: 1,
    path: 'content://com.android.externalstorage.documents/document/primary%3AMusic%2FAstraTest%2FAlbum%2F01.flac',
    folder_id: 1,
    title: 'Track',
    artist: 'Artist',
    album: 'Album',
    album_artist: null,
    album_identity_key: 'artist|album',
    duration: 180,
    track_number: 1,
    disc_number: null,
    year: null,
    genre: null,
    artwork_hash: null,
    format: 'FLAC',
    sample_rate: null,
    bit_depth: null,
    bitrate: null,
    channels: null,
    codec: null,
    bpm: null,
    musical_key: null,
    source_type: 'local',
    source_id: null,
    source_track_id: null,
    source_path: null,
    artwork_source_id: null,
    file_name: '01.flac',
    size: null,
    mtime: 1,
    added_at: 1,
    modified_at: 1,
    play_count: 0,
    last_played_at: null,
    loudness_lufs: null,
    sample_peak: null,
    replay_gain_track_db: null,
    replay_gain_album_db: null,
    ...overrides,
  };
}

test('decodes SAF tree and document paths', () => {
  assert.equal(
    decodedSafTreePath('content://com.android.externalstorage.documents/tree/primary%3AMusic%2FAstraTest'),
    'Music/AstraTest'
  );
  assert.equal(
    decodedSafDocumentPath(
      'content://com.android.externalstorage.documents/document/primary%3AMusic%2FAstraTest%2FAlbum%2F01.flac'
    ),
    'Music/AstraTest/Album/01.flac'
  );
  assert.equal(decodedSafTreePath('content://com.android.externalstorage.documents/tree/primary%3A'), '');
  assert.equal(decodedSafDocumentPath('content://example/document/primary%3AMusic%ZZ'), null);
  assert.equal(decodedSafTreePath('content://example/not-a-tree/primary%3AMusic'), null);
});

test('builds nested local folder tree from indexed SAF tracks', () => {
  const folders = [folder()];
  const tracks = [
    track({
      id: 1,
      title: 'Root Song',
      file_name: 'Root.flac',
      path: 'content://com.android.externalstorage.documents/document/primary%3AMusic%2FAstraTest%2FRoot.flac',
    }),
    track({
      id: 2,
      title: 'Nested Song',
      file_name: '01.flac',
      path: 'content://com.android.externalstorage.documents/document/primary%3AMusic%2FAstraTest%2FAlbum%2FDisc%201%2F01.flac',
    }),
    track({
      id: 3,
      title: 'Remote Song',
      folder_id: null,
      source_type: 'subsonic',
      path: 'subsonic://server/track/3',
      file_name: 'remote.flac',
    }),
  ];

  const tree = buildFolderTree(folders, tracks);

  assert.equal(tree.length, 1);
  assert.equal(tree[0].name, 'AstraTest');
  assert.equal(tree[0].totalTrackCount, 2);
  assert.deepEqual(tree[0].tracks.map((entry) => entry.title), ['Root Song']);
  assert.equal(tree[0].children[0].name, 'Album');
  assert.equal(tree[0].children[0].children[0].name, 'Disc 1');
  assert.deepEqual(tree[0].children[0].children[0].tracks.map((entry) => entry.title), ['Nested Song']);
});

test('falls back to root rows for undecodable document URIs', () => {
  const tree = buildFolderTree(
    [folder()],
    [
      track({
        path: 'content://com.android.externalstorage.documents/document/primary%3AMusic%ZZ',
        file_name: 'Fallback.flac',
      }),
    ]
  );

  assert.equal(tree.length, 1);
  assert.equal(tree[0].tracks.length, 1);
  assert.equal(tree[0].tracks[0].file_name, 'Fallback.flac');
});

test('retains unavailable folders that still have indexed local tracks', () => {
  const tree = buildFolderTree(
    [
      folder({
        available: false,
      }),
    ],
    [track()]
  );

  assert.equal(tree.length, 1);
  assert.equal(tree[0].available, false);
  assert.equal(tree[0].totalTrackCount, 1);
});

test('flattens only expanded folder nodes', () => {
  const tree = buildFolderTree(
    [folder()],
    [
      track({
        id: 1,
        title: 'Root Song',
        file_name: 'Root.flac',
        path: 'content://com.android.externalstorage.documents/document/primary%3AMusic%2FAstraTest%2FRoot.flac',
      }),
      track({
        id: 2,
        title: 'Nested Song',
        file_name: '01.flac',
        path: 'content://com.android.externalstorage.documents/document/primary%3AMusic%2FAstraTest%2FAlbum%2F01.flac',
      }),
    ]
  );
  const root = tree[0];
  const album = root.children[0];

  assert.deepEqual(
    flattenFolderTree(tree, new Set()).map((row) => row.type),
    ['folder']
  );
  assert.deepEqual(
    flattenFolderTree(tree, new Set([root.id])).map((row) =>
      row.type === 'folder' ? row.node.name : row.track.title
    ),
    ['AstraTest', 'Album', 'Root Song']
  );
  assert.deepEqual(
    flattenFolderTree(tree, new Set([root.id, album.id])).map((row) =>
      row.type === 'folder' ? row.node.name : row.track.title
    ),
    ['AstraTest', 'Album', 'Nested Song', 'Root Song']
  );
});

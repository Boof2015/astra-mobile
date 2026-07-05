import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildProvisionalAlbumIdentity,
  compareTracksByDiscTrackTitle,
  computeAlbumIdentityUpdates,
  type AlbumIdentityRow,
} from './albumIdentity.ts';

let nextId = 1;

function createRow(
  overrides: Partial<AlbumIdentityRow> & Pick<AlbumIdentityRow, 'album' | 'artist'>
): AlbumIdentityRow {
  return {
    id: overrides.id ?? nextId++,
    album: overrides.album,
    artist: overrides.artist,
    album_artist: overrides.album_artist ?? null,
    artwork_hash: overrides.artwork_hash ?? null,
    source_type: overrides.source_type ?? 'local',
    artwork_source_id: overrides.artwork_source_id ?? null,
    album_identity_key: overrides.album_identity_key ?? 'stale|key',
    album_display_artist: overrides.album_display_artist ?? null,
  };
}

test('provisional identity matches the grouped identity for explicit album artists', () => {
  const provisional = buildProvisionalAlbumIdentity('Curator', 'Artist A', 'Mixtape');
  const [update] = computeAlbumIdentityUpdates([
    createRow({ album: 'Mixtape', artist: 'Artist A', album_artist: 'Curator' }),
  ]);
  assert.equal(provisional.key, update.identityKey);
  assert.equal(provisional.displayArtist, 'Curator');
  assert.equal(update.displayArtist, 'Curator');
});

test('provisional identity uses the primary collaborator when album artist is missing', () => {
  const provisional = buildProvisionalAlbumIdentity(null, 'Jane Remover feat. Venturing', 'teen week');
  assert.equal(provisional.key, 'album:teen week::ta:jane remover');
  assert.equal(provisional.displayArtist, 'Jane Remover');
});

test('recompute merges shared-cover multi-artist albums into a Various Artists group', () => {
  const rows = [
    createRow({ id: 1, album: 'Split Release', artist: 'Artist A', artwork_hash: 'shared' }),
    createRow({ id: 2, album: 'Split Release', artist: 'Artist B', artwork_hash: 'shared' }),
  ];

  const updates = computeAlbumIdentityUpdates(rows);

  assert.equal(updates.length, 1);
  assert.equal(updates[0].identityKey, 'album:split release::ah:shared');
  assert.equal(updates[0].displayArtist, 'Various Artists');
  assert.deepEqual(updates[0].ids.sort(), [1, 2]);
});

test('recompute returns only rows whose key or display artist changed', () => {
  const rows = [
    createRow({
      id: 1,
      album: 'Mixtape',
      artist: 'Artist A',
      album_artist: 'Curator',
      album_identity_key: 'album:mixtape::aa:curator',
      album_display_artist: 'Curator',
    }),
    createRow({
      id: 2,
      album: 'Mixtape',
      artist: 'Artist B',
      album_artist: 'Curator',
      album_identity_key: 'album:mixtape::aa:curator',
      album_display_artist: null, // display artist not yet settled
    }),
  ];

  const updates = computeAlbumIdentityUpdates(rows);

  assert.equal(updates.length, 1);
  assert.deepEqual(updates[0].ids, [2]);
  assert.equal(updates[0].displayArtist, 'Curator');
});

test('remote rows use the album-scoped cover-art id as the shared-artwork signal', () => {
  const rows = [
    createRow({
      id: 1,
      album: 'Server Comp',
      artist: 'Artist A',
      source_type: 'subsonic',
      artwork_source_id: 'al-77',
    }),
    createRow({
      id: 2,
      album: 'Server Comp',
      artist: 'Artist B',
      source_type: 'subsonic',
      artwork_source_id: 'al-77',
    }),
  ];

  const updates = computeAlbumIdentityUpdates(rows);

  assert.equal(updates.length, 1);
  assert.equal(updates[0].displayArtist, 'Various Artists');
  assert.equal(updates[0].identityKey, 'album:server comp::ah:al-77');
});

test('local rows without artwork stay split per artist (desktop parity)', () => {
  const rows = [
    createRow({ id: 1, album: 'Split Release', artist: 'Artist A' }),
    createRow({ id: 2, album: 'Split Release', artist: 'Artist B' }),
  ];

  const updates = computeAlbumIdentityUpdates(rows);

  assert.equal(updates.length, 2);
  const artists = updates.map((update) => update.displayArtist).sort();
  assert.deepEqual(artists, ['Artist A', 'Artist B']);
});

test('track comparator orders disc/track nulls first with title and path tiebreaks', () => {
  const tracks = [
    { disc_number: 2, track_number: 1, title: 'D2T1', path: 'e' },
    { disc_number: null, track_number: 2, title: 'NoDisc2', path: 'd' },
    { disc_number: 1, track_number: null, title: 'B', path: 'c' },
    { disc_number: 1, track_number: null, title: 'a', path: 'b' },
    { disc_number: 1, track_number: null, title: 'a', path: 'a' },
  ];

  const sorted = [...tracks].sort(compareTracksByDiscTrackTitle);

  assert.deepEqual(
    sorted.map((track) => track.path),
    ['d', 'a', 'b', 'c', 'e']
  );
});

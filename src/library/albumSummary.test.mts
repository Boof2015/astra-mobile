import assert from 'node:assert/strict';
import test from 'node:test';
import { buildAlbumList, type AlbumSummaryTrackLike } from './albumSummary.ts';

let nextAddedAt = 1_000;

function createTrack(
  overrides: Partial<AlbumSummaryTrackLike> &
    Pick<AlbumSummaryTrackLike, 'album_identity_key' | 'album' | 'artist'>
): AlbumSummaryTrackLike {
  return {
    album_identity_key: overrides.album_identity_key,
    album: overrides.album,
    artist: overrides.artist,
    album_artist: overrides.album_artist ?? null,
    album_display_artist: overrides.album_display_artist ?? null,
    year: overrides.year ?? null,
    artwork_hash: overrides.artwork_hash ?? null,
    added_at: overrides.added_at ?? nextAddedAt++,
    source_type: overrides.source_type ?? 'local',
    source_id: overrides.source_id ?? null,
    artwork_source_id: overrides.artwork_source_id ?? null,
  };
}

test('groups by stored identity key and uses the settled display artist', () => {
  const key = 'album:split release::ah:shared';
  const albums = buildAlbumList([
    createTrack({ album_identity_key: key, album: 'Split Release', artist: 'Artist A', album_display_artist: 'Various Artists' }),
    createTrack({ album_identity_key: key, album: 'Split Release', artist: 'Artist B', album_display_artist: 'Various Artists' }),
  ]);

  assert.equal(albums.length, 1);
  assert.equal(albums[0].identity_key, key);
  assert.equal(albums[0].artist, 'Various Artists');
  assert.equal(albums[0].track_count, 2);
});

test('picks the most frequent album-name variant with lexicographic tiebreak', () => {
  const key = 'album:ok computer::aa:radiohead';
  const albums = buildAlbumList([
    createTrack({ album_identity_key: key, album: 'OK Computer', artist: 'Radiohead', album_display_artist: 'Radiohead' }),
    createTrack({ album_identity_key: key, album: 'OK COMPUTER', artist: 'Radiohead', album_display_artist: 'Radiohead' }),
    createTrack({ album_identity_key: key, album: 'OK Computer', artist: 'Radiohead', album_display_artist: 'Radiohead' }),
  ]);

  assert.equal(albums[0].album, 'OK Computer');
});

test('picks the most frequent artwork hash, max year, and latest added_at', () => {
  const key = 'album:x::aa:y';
  const albums = buildAlbumList([
    createTrack({ album_identity_key: key, album: 'X', artist: 'Y', album_display_artist: 'Y', artwork_hash: 'h1', year: 2001, added_at: 10 }),
    createTrack({ album_identity_key: key, album: 'X', artist: 'Y', album_display_artist: 'Y', artwork_hash: 'h2', year: 2003, added_at: 30 }),
    createTrack({ album_identity_key: key, album: 'X', artist: 'Y', album_display_artist: 'Y', artwork_hash: 'h2', year: 2002, added_at: 20 }),
  ]);

  assert.equal(albums[0].artwork_hash, 'h2');
  assert.equal(albums[0].year, 2003);
  assert.equal(albums[0].latest_added_at, 30);
});

test('excludes singles by default and includes them when enabled', () => {
  const tracks = [
    createTrack({ album_identity_key: 'album:solo::ta:a', album: 'Solo', artist: 'A' }),
    createTrack({ album_identity_key: 'album:full::ta:b', album: 'Full', artist: 'B' }),
    createTrack({ album_identity_key: 'album:full::ta:b', album: 'Full', artist: 'B' }),
  ];

  const defaults = buildAlbumList(tracks);
  assert.deepEqual(defaults.map((album) => album.album), ['Full']);

  const withSingles = buildAlbumList(tracks, { includeSingles: true });
  assert.deepEqual(withSingles.map((album) => album.album).sort(), ['Full', 'Solo']);
});

test('always excludes Unknown Album, even with singles enabled', () => {
  const tracks = [
    createTrack({ album_identity_key: 'album:unknown album::ta:a', album: '', artist: 'A' }),
    createTrack({ album_identity_key: 'album:unknown album::ta:a', album: '', artist: 'A' }),
  ];

  assert.equal(buildAlbumList(tracks).length, 0);
  assert.equal(buildAlbumList(tracks, { includeSingles: true }).length, 0);
});

test('falls back to tag artist when display artist is not yet settled', () => {
  const key = 'album:x::aa:curator';
  const albums = buildAlbumList([
    createTrack({ album_identity_key: key, album: 'X', artist: 'A', album_artist: 'Curator' }),
    createTrack({ album_identity_key: key, album: 'X', artist: 'B', album_artist: 'Curator' }),
  ]);

  assert.equal(albums[0].artist, 'Curator');
});

test('carries representative remote-source linkage from the first remote track', () => {
  const key = 'album:remote::aa:z';
  const albums = buildAlbumList([
    createTrack({ album_identity_key: key, album: 'Remote', artist: 'Z', album_display_artist: 'Z' }),
    createTrack({
      album_identity_key: key,
      album: 'Remote',
      artist: 'Z',
      album_display_artist: 'Z',
      source_type: 'subsonic',
      source_id: 3,
      artwork_source_id: 'al-9',
    }),
  ]);

  assert.equal(albums[0].source_type, 'subsonic');
  assert.equal(albums[0].source_id, 3);
  assert.equal(albums[0].artwork_source_id, 'al-9');
});

test('sorts by artist then album, base sensitivity', () => {
  const albums = buildAlbumList([
    createTrack({ album_identity_key: 'k1', album: 'Beta', artist: 'zeta', album_display_artist: 'zeta' }),
    createTrack({ album_identity_key: 'k1', album: 'Beta', artist: 'zeta', album_display_artist: 'zeta' }),
    createTrack({ album_identity_key: 'k2', album: 'Alpha', artist: 'Alpha Artist', album_display_artist: 'Alpha Artist' }),
    createTrack({ album_identity_key: 'k2', album: 'Alpha', artist: 'Alpha Artist', album_display_artist: 'Alpha Artist' }),
    createTrack({ album_identity_key: 'k3', album: 'Alpha', artist: 'zeta', album_display_artist: 'zeta' }),
    createTrack({ album_identity_key: 'k3', album: 'Alpha', artist: 'zeta', album_display_artist: 'zeta' }),
  ]);

  assert.deepEqual(
    albums.map((album) => `${album.artist}/${album.album}`),
    ['Alpha Artist/Alpha', 'zeta/Alpha', 'zeta/Beta']
  );
});

import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildArtistList,
  filterArtistBrowseList,
  type ArtistTrackLike,
} from './artistGrouping.ts';

let nextTimestamp = 1;

function createTrack(
  overrides: Partial<ArtistTrackLike> & Pick<ArtistTrackLike, 'artist'>
): ArtistTrackLike {
  const timestamp = nextTimestamp++;
  return {
    artist: overrides.artist,
    artist_names: overrides.artist_names ?? null,
    album_artist: overrides.album_artist ?? null,
    album_artist_names: overrides.album_artist_names ?? null,
    artwork_hash: overrides.artwork_hash ?? null,
    year: overrides.year ?? null,
    added_at: overrides.added_at ?? timestamp,
    modified_at: overrides.modified_at ?? timestamp,
    album_identity_key: overrides.album_identity_key ?? `album:${timestamp}`,
  };
}

test('canonical artist records distinguish primary and collaborator-only artists', () => {
  const artists = buildArtistList([
    createTrack({ artist: 'Primary Artist feat. Guest Artist', album_identity_key: 'album:shared' }),
    createTrack({ artist: 'Primary Artist', album_identity_key: 'album:shared' }),
  ], 'astra');

  const primary = artists.find((artist) => artist.artist === 'Primary Artist');
  const guest = artists.find((artist) => artist.artist === 'Guest Artist');

  assert.ok(primary);
  assert.equal(primary.track_count, 2);
  assert.equal(primary.primary_track_count, 2);
  assert.ok(guest);
  assert.equal(guest.track_count, 1);
  assert.equal(guest.primary_track_count, 0);
});

test('structured credits keep punctuation inside an artist name', () => {
  const artists = buildArtistList([
    createTrack({
      artist: 'Earth, Wind & Fire & The Emotions',
      artist_names: ['Earth, Wind & Fire', 'The Emotions'],
    }),
  ], 'astra');

  assert.deepEqual(
    artists.map((artist) => [artist.artist, artist.primary_track_count]),
    [
      ['Earth, Wind & Fire', 1],
      ['The Emotions', 0],
    ]
  );
  assert.ok(!artists.some((artist) => artist.artist === 'Earth'));
  assert.ok(!artists.some((artist) => artist.artist === 'Wind'));
});

test('file-tags mode keeps a structured collaboration as one display group', () => {
  const display = 'Earth, Wind & Fire & The Emotions';
  const artists = buildArtistList([
    createTrack({
      artist: display,
      artist_names: ['Earth, Wind & Fire', 'The Emotions'],
    }),
  ], 'fileTags');

  assert.deepEqual(artists.map((artist) => artist.artist), [display]);
});

test('file-tags artist records count every indexed track as primary', () => {
  const artists = buildArtistList([
    createTrack({ artist: 'Primary Artist feat. Guest Artist' }),
    createTrack({ artist: 'Primary Artist' }),
  ], 'fileTags');

  assert.ok(artists.length > 0);
  assert.ok(artists.every((artist) => artist.primary_track_count === artist.track_count));
});

test('artist browse filter defaults to primary artists and restores collab-only artists', () => {
  const artists = buildArtistList([
    createTrack({ artist: 'Primary Artist feat. Guest Artist' }),
  ], 'astra');

  assert.deepEqual(
    filterArtistBrowseList(artists, 'astra', false).map((artist) => artist.artist),
    ['Primary Artist']
  );
  assert.equal(filterArtistBrowseList(artists, 'astra', true), artists);
  assert.equal(filterArtistBrowseList(artists, 'fileTags', false), artists);
});

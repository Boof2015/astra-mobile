import assert from 'node:assert/strict';
import test from 'node:test';
import { sortTracks, TRACK_SORT_LEGACY_DIRECTIONS } from './trackSort.ts';
import { sortAlbums, ALBUM_SORT_LEGACY_DIRECTIONS } from './albumSort.ts';
import { sortArtists, ARTIST_SORT_LEGACY_DIRECTIONS } from './artistSort.ts';
import { railLettersForDirection } from './letterIndex.ts';
import { parseSortDirection } from './sortDirection.ts';
import type { Album, Artist, DbTrack } from '../types/library.ts';

function track(values: Partial<DbTrack> & Pick<DbTrack, 'path' | 'title'>): DbTrack {
  return {
    artist: '',
    album: '',
    disc_number: null,
    track_number: null,
    duration: 0,
    added_at: 0,
    ...values,
  } as DbTrack;
}

function album(values: Partial<Album> & Pick<Album, 'identity_key' | 'album'>): Album {
  return {
    artist: '',
    year: null,
    latest_added_at: 0,
    ...values,
  } as Album;
}

function artist(name: string, count: number): Artist {
  return { artist: name, track_count: count } as Artist;
}

test('missing persisted directions preserve each legacy field order', () => {
  assert.deepEqual(TRACK_SORT_LEGACY_DIRECTIONS, {
    artist: 'asc',
    title: 'asc',
    recently_added: 'desc',
    duration: 'desc',
  });
  assert.deepEqual(ALBUM_SORT_LEGACY_DIRECTIONS, {
    artist: 'asc',
    name: 'asc',
    recently_added: 'desc',
    year: 'desc',
  });
  assert.deepEqual(ARTIST_SORT_LEGACY_DIRECTIONS, { name: 'asc', track_count: 'desc' });
  assert.equal(parseSortDirection('asc'), 'asc');
  assert.equal(parseSortDirection('desc'), 'desc');
  assert.equal(parseSortDirection('sideways'), null);
});

test('track primary fields reverse while stable tiebreakers stay forward', () => {
  const tracks = [
    track({ path: 'z-2', title: 'Second', artist: 'Zulu', album: 'Beta', track_number: 2 }),
    track({ path: 'z-1', title: 'First', artist: 'Zulu', album: 'Alpha', track_number: 1 }),
    track({ path: 'a-1', title: 'Third', artist: 'Alpha', album: 'Gamma', track_number: 1 }),
  ];

  assert.deepEqual(sortTracks(tracks, 'artist', 'desc').map((item) => item.path), [
    'z-1',
    'z-2',
    'a-1',
  ]);
  assert.deepEqual(sortTracks(tracks, 'title', 'asc').map((item) => item.title), [
    'First',
    'Second',
    'Third',
  ]);
  assert.deepEqual(sortTracks(tracks, 'title', 'desc').map((item) => item.title), [
    'Third',
    'Second',
    'First',
  ]);
});

test('numeric track fields support both directions', () => {
  const tracks = [
    track({ path: 'b', title: 'B', added_at: 20, duration: 100 }),
    track({ path: 'a', title: 'A', added_at: 10, duration: 200 }),
  ];
  assert.deepEqual(sortTracks(tracks, 'recently_added', 'asc').map((item) => item.path), ['a', 'b']);
  assert.deepEqual(sortTracks(tracks, 'recently_added', 'desc').map((item) => item.path), ['b', 'a']);
  assert.deepEqual(sortTracks(tracks, 'duration', 'asc').map((item) => item.path), ['b', 'a']);
  assert.deepEqual(sortTracks(tracks, 'duration', 'desc').map((item) => item.path), ['a', 'b']);
});

test('album directions preserve natural tiebreakers and keep unknown years last', () => {
  const albums = [
    album({ identity_key: 'z-b', album: 'Beta', artist: 'Zulu', year: 2020, latest_added_at: 30 }),
    album({ identity_key: 'z-a', album: 'Alpha', artist: 'Zulu', year: null, latest_added_at: 10 }),
    album({ identity_key: 'a', album: 'Gamma', artist: 'Alpha', year: 1990, latest_added_at: 20 }),
  ];
  assert.deepEqual(sortAlbums(albums, 'artist', 'desc').map((item) => item.identity_key), [
    'z-a',
    'z-b',
    'a',
  ]);
  assert.deepEqual(sortAlbums(albums, 'year', 'asc').map((item) => item.identity_key), [
    'a',
    'z-b',
    'z-a',
  ]);
  assert.deepEqual(sortAlbums(albums, 'year', 'desc').map((item) => item.identity_key), [
    'z-b',
    'a',
    'z-a',
  ]);
});

test('artist name and count sorts reverse only their primary field', () => {
  const artists = [artist('Zulu', 2), artist('Alpha', 2), artist('Beta', 1)];
  assert.deepEqual(sortArtists(artists, 'name', 'desc').map((item) => item.artist), [
    'Zulu',
    'Beta',
    'Alpha',
  ]);
  assert.deepEqual(sortArtists(artists, 'track_count', 'desc').map((item) => item.artist), [
    'Alpha',
    'Zulu',
    'Beta',
  ]);
  assert.deepEqual(sortArtists(artists, 'track_count', 'asc').map((item) => item.artist), [
    'Beta',
    'Alpha',
    'Zulu',
  ]);
});

test('descending alphabet rail is a complete visual flip', () => {
  const ascending = railLettersForDirection('asc');
  const descending = railLettersForDirection('desc');
  assert.equal(ascending[0], '#');
  assert.equal(ascending.at(-1), 'Z');
  assert.equal(descending[0], 'Z');
  assert.equal(descending.at(-1), '#');
  assert.deepEqual(descending, [...ascending].reverse());
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { buildImportIndex, matchSyncEntry } from './importMatching.ts';
import type { DbTrack } from '../types/library.ts';

function track(overrides: Partial<DbTrack> & Pick<DbTrack, 'path' | 'title' | 'artist' | 'album' | 'file_name'>): DbTrack {
  return {
    id: 1,
    folder_id: 1,
    album_artist: null,
    album_identity_key: 'k',
    album_display_artist: null,
    duration: 200,
    track_number: null,
    disc_number: null,
    year: null,
    genre: null,
    artwork_hash: null,
    format: 'flac',
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
    size: null,
    mtime: 0,
    added_at: 0,
    modified_at: 0,
    play_count: 0,
    last_played_at: null,
    ...overrides,
  } as DbTrack;
}

function safUri(docPath: string): string {
  return `content://com.android.externalstorage.documents/document/${encodeURIComponent(`primary:${docPath}`)}`;
}

const NEBULA = track({
  path: safUri('Music/Nova/Drift/nebula.flac'),
  title: 'Nebula',
  artist: 'Nova',
  album: 'Drift',
  file_name: 'nebula.flac',
});
const NEBULA_LIVE = track({
  path: safUri('Music/Nova/Live/nebula.flac'),
  title: 'Nebula',
  artist: 'Nova',
  album: 'Live at Dawn',
  file_name: 'nebula.flac',
});
const EMBER = track({
  path: safUri('Music/Cinder/Ash/ember.flac'),
  title: 'Ember',
  artist: 'Cinder',
  album: 'Ash',
  file_name: 'ember.flac',
});

test('matches by title+artist+album with case and whitespace variance', () => {
  const index = buildImportIndex([NEBULA, NEBULA_LIVE, EMBER]);
  const match = matchSyncEntry(
    { title: '  NEBULA ', artist: 'nova', album: 'Drift  ' },
    index
  );
  assert.equal(match.kind, 'matched');
  assert.equal(match.kind === 'matched' && match.track.path, NEBULA.path);
});

test('unique source-path file name wins before metadata', () => {
  const index = buildImportIndex([EMBER, NEBULA]);
  const match = matchSyncEntry(
    { title: 'Wrong Title', artist: 'Wrong', album: 'Wrong', sourcePath: 'D:/Music/Cinder/Ash/ember.flac' },
    index
  );
  assert.equal(match.kind, 'matched');
  assert.equal(match.kind === 'matched' && match.track.path, EMBER.path);
});

test('duplicate file names resolve by trailing path-segment overlap', () => {
  const index = buildImportIndex([NEBULA, NEBULA_LIVE, EMBER]);
  const match = matchSyncEntry(
    { title: 'Nebula', artist: 'Nova', album: 'Nonexistent', sourcePath: 'D:/Library/Nova/Live/nebula.flac' },
    index
  );
  assert.equal(match.kind, 'matched');
  assert.equal(match.kind === 'matched' && match.track.path, NEBULA_LIVE.path);
});

test('ambiguous file-name rung falls through to metadata instead of giving up', () => {
  // Same file name, same trailing segment depth -> tied overlap; the
  // title+artist+album rung must still resolve it.
  const a = track({
    path: safUri('One/song.flac'),
    title: 'Song',
    artist: 'A',
    album: 'First',
    file_name: 'song.flac',
  });
  const b = track({
    path: safUri('Two/song.flac'),
    title: 'Song',
    artist: 'A',
    album: 'Second',
    file_name: 'song.flac',
  });
  const index = buildImportIndex([a, b]);
  const match = matchSyncEntry(
    { title: 'Song', artist: 'A', album: 'Second', sourcePath: 'Z:/Elsewhere/song.flac' },
    index
  );
  assert.equal(match.kind, 'matched');
  assert.equal(match.kind === 'matched' && match.track.path, b.path);
});

test('duplicate metadata identity reports ambiguous, not a guess', () => {
  const a = track({
    path: safUri('One/x.flac'),
    title: 'Twin',
    artist: 'Dup',
    album: 'Same',
    file_name: 'x.flac',
  });
  const b = track({
    path: safUri('Two/y.flac'),
    title: 'Twin',
    artist: 'Dup',
    album: 'Same',
    file_name: 'y.flac',
  });
  const index = buildImportIndex([a, b]);
  const match = matchSyncEntry({ title: 'Twin', artist: 'Dup', album: 'Same' }, index);
  assert.equal(match.kind, 'ambiguous');
});

test('falls back to title+artist then title-only rungs', () => {
  const index = buildImportIndex([NEBULA, EMBER]);
  // Album mismatch -> title+artist rung; but 'Nebula' by 'Nova' exists twice
  // in the library? No — only NEBULA here, so title+artist matches.
  const byTitleArtist = matchSyncEntry({ title: 'Nebula', artist: 'Nova', album: 'Renamed Album' }, index);
  assert.equal(byTitleArtist.kind, 'matched');

  const byTitle = matchSyncEntry({ title: 'Ember', artist: 'Different Artist', album: '' }, index);
  assert.equal(byTitle.kind, 'matched');
  assert.equal(byTitle.kind === 'matched' && byTitle.track.path, EMBER.path);
});

test('no title means no identity', () => {
  const index = buildImportIndex([NEBULA]);
  assert.equal(matchSyncEntry({ title: '   ', artist: 'Nova', album: 'Drift' }, index).kind, 'none');
});

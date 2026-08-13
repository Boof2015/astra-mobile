import assert from 'node:assert/strict';
import test from 'node:test';
import {
  MOBILE_SESSION_KIND,
  MOBILE_SESSION_SCHEMA_VERSION,
  normalizeMobileSessionSnapshot,
  parseMobileSessionSnapshot,
  resolvePlaybackSession,
  stringifyMobileSessionSnapshot,
  type MobileSessionSnapshotV1,
} from './sessionState.ts';

const tracks = [
  { path: 'file:///a.flac', duration: 100, title: 'A' },
  { path: 'file:///b.flac', duration: 200, title: 'B' },
  { path: 'file:///c.flac', duration: 300, title: 'C' },
];

test('round trips a normalized versioned snapshot', () => {
  const snapshot: MobileSessionSnapshotV1 = {
    kind: MOBILE_SESSION_KIND,
    schemaVersion: MOBILE_SESSION_SCHEMA_VERSION,
    savedAt: 123,
    playback: {
      queuePaths: ['file:///a.flac', 'file:///b.flac'],
      activeIndex: 1,
      position: 80,
      shuffle: true,
      repeat: 'all',
      originalOrderPaths: ['file:///b.flac', 'file:///a.flac'],
      source: { kind: 'playlist', label: 'Playlist 11' },
    },
  };

  assert.deepEqual(parseMobileSessionSnapshot(stringifyMobileSessionSnapshot(snapshot)), snapshot);
});

test('rejects unknown versions and safely defaults corrupt fields', () => {
  assert.equal(normalizeMobileSessionSnapshot({ kind: MOBILE_SESSION_KIND, schemaVersion: 99 }), null);
  assert.equal(parseMobileSessionSnapshot('{broken'), null);

  const normalized = normalizeMobileSessionSnapshot({
    kind: MOBILE_SESSION_KIND,
    schemaVersion: MOBILE_SESSION_SCHEMA_VERSION,
    savedAt: -5,
    playback: {
      queuePaths: ['file:///a.flac', 'file:///b.flac'],
      activeIndex: 999,
      position: -10,
      shuffle: 'yes',
      repeat: 'invalid',
      originalOrderPaths: ['file:///a.flac'],
    },
  });

  assert.equal(normalized?.savedAt, 0);
  assert.deepEqual(normalized?.playback, {
    queuePaths: ['file:///a.flac', 'file:///b.flac'],
    activeIndex: 1,
    position: 0,
    shuffle: false,
    repeat: 'none',
    originalOrderPaths: ['file:///a.flac', 'file:///b.flac'],
    source: null,
  });
});

test('keeps the queue from snapshots written before route restore was removed', () => {
  // Builds before this change stored the last route alongside the queue at the
  // same schema version. Those snapshots must still restore playback on upgrade
  // — bumping the version instead of ignoring the field would wipe every
  // existing user's queue on first launch.
  const legacy = normalizeMobileSessionSnapshot({
    kind: MOBILE_SESSION_KIND,
    schemaVersion: MOBILE_SESSION_SCHEMA_VERSION,
    savedAt: 123,
    lastStableHref: '/library/artist/Radiohead',
    playback: {
      queuePaths: ['file:///a.flac', 'file:///b.flac'],
      activeIndex: 1,
      position: 80,
      shuffle: true,
      repeat: 'all',
      originalOrderPaths: ['file:///b.flac', 'file:///a.flac'],
    },
  });

  assert.equal(legacy?.playback?.activeIndex, 1);
  assert.equal(legacy?.playback?.position, 80);
  assert.equal(legacy?.playback?.shuffle, true);
  assert.deepEqual(Object.keys(legacy ?? {}).sort(), [
    'kind',
    'playback',
    'savedAt',
    'schemaVersion',
  ]);
});

test('accepts legacy playback snapshots without a source and rejects malformed sources', () => {
  const legacy = normalizeMobileSessionSnapshot({
    kind: MOBILE_SESSION_KIND,
    schemaVersion: MOBILE_SESSION_SCHEMA_VERSION,
    savedAt: 123,
    playback: {
      queuePaths: ['file:///a.flac'],
      activeIndex: 0,
      position: 12,
      shuffle: false,
      repeat: 'none',
      originalOrderPaths: ['file:///a.flac'],
    },
  });
  assert.equal(legacy?.playback?.source, null);

  const malformed = normalizeMobileSessionSnapshot({
    ...legacy,
    playback: {
      ...legacy?.playback,
      source: { kind: 'playlist', label: '   ' },
    },
  });
  assert.equal(malformed?.playback?.source, null);
});

test('restores duplicates and clamps position to the current duration', () => {
  const resolved = resolvePlaybackSession(
    {
      queuePaths: ['file:///a.flac', 'file:///b.flac', 'file:///a.flac'],
      activeIndex: 2,
      position: 500,
      shuffle: true,
      repeat: 'one',
      originalOrderPaths: ['file:///a.flac', 'file:///a.flac', 'file:///b.flac'],
    },
    tracks
  );

  assert.deepEqual(resolved?.tracks.map((track) => track.title), ['A', 'B', 'A']);
  assert.equal(resolved?.activeIndex, 2);
  assert.equal(resolved?.position, 100);
  assert.deepEqual(resolved?.originalOrderPaths, ['file:///a.flac', 'file:///a.flac', 'file:///b.flac']);
});

test('chooses the next survivor when the active track disappeared, then the previous', () => {
  const next = resolvePlaybackSession(
    {
      queuePaths: ['file:///a.flac', 'file:///missing.flac', 'file:///c.flac'],
      activeIndex: 1,
      position: 42,
      shuffle: false,
      repeat: 'none',
      originalOrderPaths: ['file:///a.flac', 'file:///missing.flac', 'file:///c.flac'],
      source: { kind: 'favorites', label: 'Favorites' },
    },
    tracks
  );
  assert.equal(next?.tracks[next.activeIndex].title, 'C');
  assert.equal(next?.position, 0);
  assert.deepEqual(next?.source, { kind: 'favorites', label: 'Favorites' });

  const previous = resolvePlaybackSession(
    {
      queuePaths: ['file:///a.flac', 'file:///missing.flac'],
      activeIndex: 1,
      position: 42,
      shuffle: false,
      repeat: 'none',
      originalOrderPaths: ['file:///a.flac', 'file:///missing.flac'],
    },
    tracks
  );
  assert.equal(previous?.tracks[previous.activeIndex].title, 'A');
  assert.equal(previous?.position, 0);
});

test('returns null when no queued path still exists', () => {
  assert.equal(
    resolvePlaybackSession(
      {
        queuePaths: ['file:///missing.flac'],
        activeIndex: 0,
        position: 10,
        shuffle: false,
        repeat: 'none',
        originalOrderPaths: ['file:///missing.flac'],
      },
      tracks
    ),
    null
  );
});

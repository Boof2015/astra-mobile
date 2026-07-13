import assert from 'node:assert/strict';
import test from 'node:test';
import {
  MOBILE_SESSION_KIND,
  MOBILE_SESSION_SCHEMA_VERSION,
  hasExplicitLaunchDestination,
  normalizeMobileSessionSnapshot,
  normalizeStableHref,
  parseMobileSessionSnapshot,
  resolvePlaybackSession,
  shouldRestoreSavedRoute,
  stringifyMobileSessionSnapshot,
  stableHrefForRoute,
  validateRestoredHref,
  type MobileSessionSnapshotV1,
} from './sessionState.ts';

const tracks = [
  { path: 'file:///a.flac', duration: 100, title: 'A' },
  { path: 'file:///b.flac', duration: 200, title: 'B' },
  { path: 'file:///c.flac', duration: 300, title: 'C' },
];

test('normalizes stable routes and rejects transient or unsafe routes', () => {
  assert.equal(normalizeStableHref('/library/album/album%3Aone'), '/library/album/album%3Aone');
  assert.equal(normalizeStableHref('/library/artist/Artist?credit=1&ignored=yes'), '/library/artist/Artist?credit=1');
  assert.equal(normalizeStableHref('/settings/audio?ignored=yes'), '/settings/audio');
  assert.equal(normalizeStableHref('/library/playlist/edit-dynamic?id=4'), null);
  assert.equal(normalizeStableHref('/eq/scan'), null);
  assert.equal(normalizeStableHref('/notification.click'), null);
  assert.equal(normalizeStableHref('/library/artist/AC%2FDC'), '/library/artist/AC%2FDC');
  assert.equal(normalizeStableHref('/library/album/%2E%2E'), null);
  assert.equal(normalizeStableHref('/unknown'), null);
});

test('validates saved detail targets and falls back to Library when they disappeared', () => {
  const context = {
    hasAlbum: (key: string) => key === 'kept/album',
    hasArtist: (name: string, credit: boolean) => name === 'AC/DC' && credit,
    hasPlaylist: (id: number) => id === 7,
  };
  assert.equal(validateRestoredHref('/library/album/kept%2Falbum', context), '/library/album/kept%2Falbum');
  assert.equal(validateRestoredHref('/library/album/deleted', context), '/library');
  assert.equal(validateRestoredHref('/library/artist/AC%2FDC?credit=1', context), '/library/artist/AC%2FDC?credit=1');
  assert.equal(validateRestoredHref('/library/playlist/7', context), '/library/playlist/7');
  assert.equal(validateRestoredHref('/library/playlist/8', context), '/library');
  assert.equal(validateRestoredHref('/library/playlist/favorites', context), '/library/playlist/favorites');
});

test('builds encoded stable hrefs from Expo Router file segments', () => {
  assert.equal(
    stableHrefForRoute(['(tabs)', 'library', 'album', '[key]'], '/library/album/a/b', { key: 'a/b' }),
    '/library/album/a%2Fb'
  );
  assert.equal(
    stableHrefForRoute(
      ['(tabs)', 'library', 'artist', '[name]', 'songs'],
      '/library/artist/AC/DC/songs',
      { name: 'AC/DC', credit: '1' }
    ),
    '/library/artist/AC%2FDC/songs?credit=1'
  );
  assert.equal(
    stableHrefForRoute(['(tabs)', 'library', 'playlist', '[id]'], '/library/playlist/7', { id: '7' }),
    '/library/playlist/7'
  );
});

test('distinguishes launcher opens from explicit deep links', () => {
  assert.equal(hasExplicitLaunchDestination(null), false);
  assert.equal(hasExplicitLaunchDestination('astra://'), false);
  assert.equal(hasExplicitLaunchDestination('astra://library/album/key'), true);
  assert.equal(hasExplicitLaunchDestination('https://example.test/--/notification.click'), true);
  assert.equal(hasExplicitLaunchDestination('content://shared/eq-preset'), true);
});

test('lets external destinations win while restoring over transient navigation state', () => {
  assert.equal(shouldRestoreSavedRoute('/', null), true);
  assert.equal(shouldRestoreSavedRoute('/eq/scan', null), true);
  assert.equal(shouldRestoreSavedRoute('/lastfm/edit', null), true);
  assert.equal(shouldRestoreSavedRoute('/recently-played', null), false);
  assert.equal(shouldRestoreSavedRoute('/notification.click', null), false);
  assert.equal(shouldRestoreSavedRoute('/', 'astra://library/playlist/7'), false);
});

test('round trips a normalized versioned snapshot', () => {
  const snapshot: MobileSessionSnapshotV1 = {
    kind: MOBILE_SESSION_KIND,
    schemaVersion: MOBILE_SESSION_SCHEMA_VERSION,
    savedAt: 123,
    lastStableHref: '/library/playlist/7',
    playback: {
      queuePaths: ['file:///a.flac', 'file:///b.flac'],
      activeIndex: 1,
      position: 80,
      shuffle: true,
      repeat: 'all',
      originalOrderPaths: ['file:///b.flac', 'file:///a.flac'],
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
    lastStableHref: '/eq/import?data=large',
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
  assert.equal(normalized?.lastStableHref, '/');
  assert.deepEqual(normalized?.playback, {
    queuePaths: ['file:///a.flac', 'file:///b.flac'],
    activeIndex: 1,
    position: 0,
    shuffle: false,
    repeat: 'none',
    originalOrderPaths: ['file:///a.flac', 'file:///b.flac'],
  });
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
    },
    tracks
  );
  assert.equal(next?.tracks[next.activeIndex].title, 'C');
  assert.equal(next?.position, 0);

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

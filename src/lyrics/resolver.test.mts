import assert from 'node:assert/strict';
import test from 'node:test';
import type { LyricsCacheEntry } from '../db/lyricsQueries.ts';
import type { EmbeddedLyricsResolution } from './embedded.ts';
import {
  resolveLyricsWithDependencies,
  type LyricsProviderLookupResult,
  type LyricsResolverDependencies,
} from './resolver.ts';
import type { LyricsPayload, LyricsSource, LyricsTrackQuery } from './types.ts';

const QUERY: LyricsTrackQuery = {
  path: 'content://music/track.mp3',
  title: 'Track',
  artist: 'Artist',
  album: 'Album',
  durationSeconds: 180,
};

function payload(source: LyricsSource, text: string): LyricsPayload {
  return {
    source,
    provider: source === 'xlrcdb' || source === 'lrclib' ? source : null,
    format: 'plain',
    plainLyrics: text,
    syncedLyrics: null,
    syncedLines: [],
  };
}

function cache(source: LyricsSource, text: string): LyricsCacheEntry {
  return {
    status: 'hit',
    source,
    provider: source === 'xlrcdb' || source === 'lrclib' ? source : null,
    format: 'plain',
    plainLyrics: text,
    syncedLyrics: null,
    syncedLines: [],
  };
}

function dependencies(overrides: Partial<LyricsResolverDependencies> = {}) {
  const calls = {
    sidecar: 0,
    embedded: 0,
    cache: 0,
    deleteCache: 0,
    cachedHits: [] as LyricsPayload[],
    notFound: 0,
    xlrcdb: 0,
    lrclib: 0,
  };
  const deps: LyricsResolverDependencies = {
    resolveSidecar: async () => {
      calls.sidecar += 1;
      return null;
    },
    resolveEmbedded: async (): Promise<EmbeddedLyricsResolution> => {
      calls.embedded += 1;
      return { status: 'missing' };
    },
    getCache: async () => {
      calls.cache += 1;
      return null;
    },
    deleteCache: async () => {
      calls.deleteCache += 1;
    },
    cacheHit: async (lyrics) => {
      calls.cachedHits.push(lyrics);
    },
    cacheNotFound: async () => {
      calls.notFound += 1;
    },
    lookupXlrcdb: async (): Promise<LyricsProviderLookupResult> => {
      calls.xlrcdb += 1;
      return { status: 'not_found' };
    },
    lookupLrclib: async (): Promise<LyricsProviderLookupResult> => {
      calls.lrclib += 1;
      return { status: 'not_found' };
    },
    ...overrides,
  };
  return { calls, deps };
}

test('sidecar remains the highest-priority source', async () => {
  const sidecar = payload('lrc', 'Sidecar');
  const { calls, deps } = dependencies({ resolveSidecar: async () => sidecar });

  const result = await resolveLyricsWithDependencies(
    QUERY,
    { forceRefresh: false, onlineEnabled: true },
    deps
  );

  assert.equal(result.status === 'hit' ? result.lyrics.source : '', 'lrc');
  assert.equal(calls.embedded, 0);
  assert.equal(calls.cache, 0);
});

test('fresh embedded lyrics beat a cached online result and replace it', async () => {
  const embedded = payload('embedded', 'Local');
  const { calls, deps } = dependencies({
    resolveEmbedded: async () => ({ status: 'hit', lyrics: embedded }),
    getCache: async () => cache('xlrcdb', 'Online'),
  });

  const result = await resolveLyricsWithDependencies(
    QUERY,
    { forceRefresh: false, onlineEnabled: true },
    deps
  );

  assert.equal(result.status === 'hit' ? result.lyrics.source : '', 'embedded');
  assert.equal(calls.cache, 0);
  assert.deepEqual(calls.cachedHits, [embedded]);
  assert.equal(calls.xlrcdb, 0);
});

test('a confirmed embedded miss removes a stale embedded cache row', async () => {
  const { calls, deps } = dependencies({
    getCache: async () => cache('embedded', 'Removed'),
  });

  const result = await resolveLyricsWithDependencies(
    QUERY,
    { forceRefresh: false, onlineEnabled: false },
    deps
  );

  assert.deepEqual(result, { status: 'not_found', reason: 'online-disabled' });
  assert.equal(calls.deleteCache, 1);
});

test('an unavailable metadata reader preserves and returns cached lyrics', async () => {
  const { calls, deps } = dependencies({
    resolveEmbedded: async () => ({ status: 'unavailable' }),
    getCache: async () => cache('embedded', 'Cached local'),
  });

  const result = await resolveLyricsWithDependencies(
    QUERY,
    { forceRefresh: false, onlineEnabled: false },
    deps
  );

  assert.equal(result.status === 'hit' ? result.lyrics.plainLyrics : '', 'Cached local');
  assert.equal(result.status === 'hit' ? result.cached : false, true);
  assert.equal(calls.deleteCache, 0);
});

test('local misses fall through to XLRCDB then LRCLIB and cache definitive misses', async () => {
  const { calls, deps } = dependencies();

  const result = await resolveLyricsWithDependencies(
    QUERY,
    { forceRefresh: false, onlineEnabled: true },
    deps
  );

  assert.deepEqual(result, { status: 'not_found', reason: 'provider-not-found' });
  assert.equal(calls.xlrcdb, 1);
  assert.equal(calls.lrclib, 1);
  assert.equal(calls.notFound, 1);
});

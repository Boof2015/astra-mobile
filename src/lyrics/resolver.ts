import type { LyricsCacheEntry } from '../db/lyricsQueries';
import type { EmbeddedLyricsResolution } from './embedded';
import { createLyricsPayload } from './parsing.ts';
import type { LyricsLookupResult, LyricsPayload, LyricsTrackQuery } from './types';

export type LyricsProviderLookupResult =
  | { status: 'hit'; lyrics: LyricsPayload }
  | { status: 'not_found' }
  | { status: 'skipped'; reason: string }
  | { status: 'provider_unavailable' }
  | { status: 'transient_error'; message: string; code?: string };

export interface LyricsResolverDependencies {
  resolveSidecar: (trackPath: string) => Promise<LyricsPayload | null>;
  resolveEmbedded: (trackPath: string) => Promise<EmbeddedLyricsResolution>;
  getCache: () => Promise<LyricsCacheEntry | null>;
  deleteCache: () => Promise<void>;
  cacheHit: (payload: LyricsPayload) => Promise<void>;
  cacheNotFound: () => Promise<void>;
  lookupXlrcdb: (query: LyricsTrackQuery, forceRefresh: boolean) => Promise<LyricsProviderLookupResult>;
  lookupLrclib: (query: LyricsTrackQuery, forceRefresh: boolean) => Promise<LyricsProviderLookupResult>;
}

export interface LyricsResolverOptions {
  forceRefresh: boolean;
  onlineEnabled: boolean;
}

export function resultFromLyricsCache(cache: LyricsCacheEntry): LyricsLookupResult | null {
  if (cache.status === 'hit') {
    const payload = createLyricsPayload(
      cache.source,
      cache.provider,
      cache.format,
      cache.plainLyrics,
      cache.syncedLyrics,
      cache.syncedLines
    );
    if (!payload) return null;
    return { status: 'hit', lyrics: payload, cached: true };
  }
  return {
    status: 'not_found',
    reason: cache.source === 'embedded' ? 'embedded-missing' : 'provider-not-found',
  };
}

/**
 * Source-order policy isolated from Expo/native/database imports so it can be
 * exercised directly under Node. Local sources always run before persisted or
 * online results.
 */
export async function resolveLyricsWithDependencies(
  query: LyricsTrackQuery,
  options: LyricsResolverOptions,
  dependencies: LyricsResolverDependencies
): Promise<LyricsLookupResult> {
  const { forceRefresh, onlineEnabled } = options;

  const sidecar = await dependencies.resolveSidecar(query.path);
  if (sidecar) return { status: 'hit', lyrics: sidecar, cached: false };

  const embedded = await dependencies.resolveEmbedded(query.path);
  if (embedded.status === 'hit') {
    await dependencies.cacheHit(embedded.lyrics);
    return { status: 'hit', lyrics: embedded.lyrics, cached: false };
  }

  let cached = await dependencies.getCache();
  if (embedded.status === 'missing' && cached?.source === 'embedded') {
    await dependencies.deleteCache();
    cached = null;
  }

  let lrclibCached: LyricsCacheEntry | null = null;
  if ((!forceRefresh || !onlineEnabled) && cached) {
    // Preserve the existing migration behavior: an older LRCLIB cache hit waits
    // until XLRCDB has had one chance to provide the preferred result.
    if (cached.status === 'hit' && cached.source === 'lrclib' && onlineEnabled) {
      lrclibCached = cached;
    } else {
      const cachedResult = resultFromLyricsCache(cached);
      if (cachedResult) return cachedResult;
    }
  }

  if (!onlineEnabled) return { status: 'not_found', reason: 'online-disabled' };

  const xlrcdb = await dependencies.lookupXlrcdb(query, forceRefresh);
  if (xlrcdb.status === 'hit') {
    await dependencies.cacheHit(xlrcdb.lyrics);
    return { status: 'hit', lyrics: xlrcdb.lyrics, cached: false };
  }

  if (lrclibCached) {
    const cachedResult = resultFromLyricsCache(lrclibCached);
    if (cachedResult) return cachedResult;
  }

  const lrclib = await dependencies.lookupLrclib(query, forceRefresh);
  if (lrclib.status === 'hit') {
    await dependencies.cacheHit(lrclib.lyrics);
    return { status: 'hit', lyrics: lrclib.lyrics, cached: false };
  }
  if (lrclib.status === 'provider_unavailable') {
    return { status: 'not_found', reason: 'provider-unavailable' };
  }
  if (lrclib.status === 'transient_error') {
    return { status: 'transient_error', message: lrclib.message, code: lrclib.code };
  }

  if (xlrcdb.status === 'not_found') await dependencies.cacheNotFound();
  return { status: 'not_found', reason: 'provider-not-found' };
}

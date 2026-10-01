import { useEffect, useMemo, useRef, useState } from 'react';
import type { CoverArtAccentMethod } from './artworkAccentPreferences';
import type { AdaptiveAccentTarget } from './adaptiveAccent';
import { md5Hex } from '@/lib/hash';
import { ArtworkAccentCache, artworkAccentCacheKey } from './artworkAccentCache';
import { extractArtworkAccent } from './artworkAccent';

const accentCache = new ArtworkAccentCache(256);

interface UseNowPlayingArtworkAccentInput {
  enabled: boolean;
  artworkUri: string | null;
  artworkIdentity: string | null;
  method: CoverArtAccentMethod;
  target: AdaptiveAccentTarget;
}

export function useNowPlayingArtworkAccent({
  enabled,
  artworkUri,
  artworkIdentity,
  method,
  target: { isLight, onAccent },
}: UseNowPlayingArtworkAccentInput): string | null {
  const adaptiveTarget = useMemo(
    () => method === 'adaptive' ? { isLight, onAccent } : undefined,
    [method, isLight, onAccent],
  );
  const artworkSourceHash = useMemo(
    () => (enabled && artworkUri ? md5Hex(artworkUri) : null),
    [artworkUri, enabled],
  );
  const cacheKey =
    enabled && artworkUri && artworkIdentity && artworkSourceHash
      ? artworkAccentCacheKey(artworkIdentity, artworkSourceHash, method, { isLight, onAccent })
      : null;
  const [resolved, setResolved] = useState<{
    key: string;
    accent: string | null;
  } | null>(null);
  const requestToken = useRef(0);

  useEffect(() => {
    requestToken.current += 1;
    const token = requestToken.current;
    if (!cacheKey || !artworkUri) return;

    const cached = accentCache.get(cacheKey);
    if (cached.found) {
      queueMicrotask(() => {
        if (requestToken.current === token) {
          setResolved({ key: cacheKey, accent: cached.value });
        }
      });
      return () => {
        requestToken.current += 1;
      };
    }

    void extractArtworkAccent(artworkUri, method, adaptiveTarget).then((nextAccent) => {
      if (requestToken.current !== token) return;
      accentCache.set(cacheKey, nextAccent);
      setResolved({ key: cacheKey, accent: nextAccent });
    });

    return () => {
      requestToken.current += 1;
    };
  }, [artworkUri, cacheKey, method, adaptiveTarget]);

  return cacheKey && resolved?.key === cacheKey ? resolved.accent : null;
}

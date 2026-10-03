import { useEffect, useRef, useState } from 'react';
import { md5Hex } from '@/lib/hash';
import { ArtworkAccentCache } from './artworkAccentCache';
import { extractArtworkField } from './artworkAccent';
import type { ArtworkField } from './artworkField';

const fieldCache = new ArtworkAccentCache<ArtworkField>(128);

interface UseArtworkFieldInput {
  enabled: boolean;
  /** Prefer the low-res thumbnail: the field only needs area colors. */
  artworkUri: string | null;
  isDark: boolean;
}

/**
 * The living-gradient colors for the current cover. Independent of the accent
 * source setting: a user on a preset accent still gets a backdrop made of the
 * cover. Returns the last resolved field until the next one lands, so a track
 * change cross-fades instead of dropping to nothing in between.
 */
export function useArtworkField({ enabled, artworkUri, isDark }: UseArtworkFieldInput): ArtworkField | null {
  const cacheKey = enabled && artworkUri ? `${isDark ? 'dark' : 'light'}:${md5Hex(artworkUri)}` : null;
  const [resolved, setResolved] = useState<{ key: string; field: ArtworkField | null } | null>(null);
  const requestToken = useRef(0);

  useEffect(() => {
    requestToken.current += 1;
    const token = requestToken.current;
    if (!cacheKey || !artworkUri) return;

    const cached = fieldCache.get(cacheKey);
    if (cached.found) {
      queueMicrotask(() => {
        if (requestToken.current === token) setResolved({ key: cacheKey, field: cached.value });
      });
      return () => {
        requestToken.current += 1;
      };
    }

    void extractArtworkField(artworkUri, isDark).then((field) => {
      fieldCache.set(cacheKey, field);
      if (requestToken.current !== token) return;
      setResolved({ key: cacheKey, field });
    });
    return () => {
      requestToken.current += 1;
    };
  }, [artworkUri, cacheKey, isDark]);

  if (!cacheKey) return null;
  return resolved?.field ?? null;
}

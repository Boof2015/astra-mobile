import { useEffect, useRef, useState } from 'react';
import { md5Hex } from '@/lib/hash';
import { ArtworkAccentCache } from './artworkAccentCache';
import { extractArtworkColors } from './artworkAccent';
import type { AdaptiveAccentTarget } from './adaptiveAccent';
import type { CoverArtAccentMethod } from './artworkAccentPreferences';
import type { ArtworkColors } from './artworkColors';

const colorCache = new ArtworkAccentCache<ArtworkColors>(256);
const NO_COLORS: ArtworkColors = { accent: null, field: null };

/**
 * How long a new cover must stay current before its colors are worked out.
 * The decode and clustering run on the JS thread; starting them at the switch
 * stalled the cover slide and the waveform morph (device pass, 2026-10-02).
 * Waiting out the transition keeps them clear of it, and a cover that is
 * skipped straight past is never computed at all.
 */
export const ARTWORK_COLORS_SETTLE_MS = 450;

interface UseNowPlayingArtworkColorsInput {
  /** False while backgrounded: nothing on screen needs the colors. */
  enabled: boolean;
  /** The low-res thumbnail; never the full cover. */
  artworkUri: string | null;
  artworkIdentity: string | null;
  accent: { enabled: boolean; method: CoverArtAccentMethod; target: AdaptiveAccentTarget };
  isDark: boolean;
}

/**
 * The cover's accent and backdrop field. Across a track change the previous
 * cover's colors stay until the new ones are ready, so the palette changes
 * once, after the transition, instead of dropping to the app accent in
 * between. Cached covers apply immediately.
 */
export function useNowPlayingArtworkColors({
  enabled,
  artworkUri,
  artworkIdentity,
  accent: { enabled: accentEnabled, method, target: { isLight, onAccent } },
  isDark,
}: UseNowPlayingArtworkColorsInput): ArtworkColors {
  // Everything that changes the *tones*, as opposed to which cover they come from.
  const toneKey = `${isDark ? 'dark' : 'light'}:${
    accentEnabled ? `${method}:${method === 'adaptive' ? `${isLight}:${onAccent}` : ''}` : 'no-accent'
  }`;
  const cacheKey =
    enabled && artworkUri ? `${toneKey}:${artworkIdentity ?? ''}:${md5Hex(artworkUri)}` : null;
  const [resolved, setResolved] = useState<{ key: string; toneKey: string; colors: ArtworkColors } | null>(null);
  const requestToken = useRef(0);

  useEffect(() => {
    requestToken.current += 1;
    const token = requestToken.current;
    if (!cacheKey || !artworkUri) return;

    const cached = colorCache.get(cacheKey);
    if (cached.found) {
      queueMicrotask(() => {
        if (requestToken.current === token) {
          setResolved({ key: cacheKey, toneKey, colors: cached.value ?? NO_COLORS });
        }
      });
      return () => {
        requestToken.current += 1;
      };
    }

    const timer = setTimeout(() => {
      if (requestToken.current !== token) return;
      void extractArtworkColors(
        artworkUri,
        accentEnabled ? { method, target: { isLight, onAccent } } : null,
        isDark,
      ).then((colors) => {
        colorCache.set(cacheKey, colors);
        if (requestToken.current === token) {
          setResolved({ key: cacheKey, toneKey, colors: colors ?? NO_COLORS });
        }
      });
    }, ARTWORK_COLORS_SETTLE_MS);
    return () => {
      clearTimeout(timer);
      requestToken.current += 1;
    };
  }, [accentEnabled, artworkUri, cacheKey, isDark, isLight, method, onAccent, toneKey]);

  if (!artworkUri) return NO_COLORS;
  // Hold the previous cover's colors only while their tones still apply: a
  // theme or accent-setting change must not show colors made for the old one.
  if (!resolved || resolved.toneKey !== toneKey) return NO_COLORS;
  return resolved.colors;
}

/**
 * Everything now-playing derives from the cover, from one pixel buffer and one
 * clustering pass: the accent and the backdrop field. They used to be two
 * extractions — a full-resolution decode for the accent and a thumbnail decode
 * for the field, each clustering on its own — and that work landed on the JS
 * thread in the middle of every track change.
 */
import { scoreColors, toneForTheme, type AdaptiveAccentTarget } from './adaptiveAccent.ts';
import { extractArtworkAccentFromPixels } from './artworkAccentMath.ts';
import type { CoverArtAccentMethod } from './artworkAccentPreferences.ts';
import { clusterArtworkPixels, fieldFromClusters, type ArtworkField } from './artworkField.ts';

export interface ArtworkColors {
  /** Null when the accent is not taken from the cover, or the cover gave none. */
  accent: string | null;
  field: ArtworkField | null;
}

export interface ArtworkAccentRequest {
  method: CoverArtAccentMethod;
  target: AdaptiveAccentTarget;
}

/** Adaptive's alpha cutoff: a fully transparent sample has no accent at all. */
const ADAPTIVE_MIN_ALPHA = 48;

function hasVisiblePixel(pixels: ArrayLike<number>): boolean {
  for (let i = 3; i < pixels.length; i += 4) {
    if (pixels[i] >= ADAPTIVE_MIN_ALPHA) return true;
  }
  return false;
}

export function artworkColorsFromPixels(
  pixels: Uint8Array,
  accent: ArtworkAccentRequest | null,
  isDark: boolean,
): ArtworkColors {
  const clusters = clusterArtworkPixels(pixels);
  let accentHex: string | null = null;
  if (accent) {
    accentHex =
      accent.method === 'adaptive'
        ? hasVisiblePixel(pixels)
          ? toneForTheme(scoreColors(clusters)[0]?.lab ?? null, accent.target)
          : null
        : extractArtworkAccentFromPixels(pixels, accent.method, accent.target);
  }
  return { accent: accentHex, field: fieldFromClusters(clusters, isDark) };
}

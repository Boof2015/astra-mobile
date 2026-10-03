import {
  AlphaType,
  ColorType,
  Skia,
  rect,
  type SkData,
} from '@shopify/react-native-skia';
import type { CoverArtAccentMethod } from './artworkAccentPreferences';
import type { AdaptiveAccentTarget } from './adaptiveAccent';
import { extractArtworkAccentFromPixels } from './artworkAccentMath';
import { fieldFromPixels, type ArtworkField } from './artworkField';

const SAMPLE_SIZE = 128;
/** The field only needs area colors, and it decodes once per track change. */
const FIELD_SAMPLE_SIZE = 64;

async function encodedArtworkData(uri: string) {
  const dataUrl = /^data:[^;,]+;base64,(.+)$/s.exec(uri);
  return dataUrl
    ? Skia.Data.fromBase64(dataUrl[1])
    : Skia.Data.fromURI(uri);
}

/**
 * Decode the artwork and read it back as RGBA_8888 at `size`x`size`. Shared by
 * the accent and the backdrop field so neither carries its own copy of the
 * Skia resource handling.
 */
async function readArtworkPixels(artworkUri: string, size: number): Promise<Uint8Array | null> {
  let encoded: SkData | null = null;
  try {
    encoded = await encodedArtworkData(artworkUri);
    const source = Skia.Image.MakeImageFromEncoded(encoded);
    if (!source) return null;
    try {
      const surface = Skia.Surface.MakeOffscreen(size, size);
      if (!surface) return null;
      try {
        const paint = Skia.Paint();
        try {
          surface.getCanvas().drawImageRect(
            source,
            rect(0, 0, source.width(), source.height()),
            rect(0, 0, size, size),
            paint,
          );
          surface.flush();
          const snapshot = surface.makeImageSnapshot();
          try {
            const pixels = snapshot.readPixels(0, 0, {
              width: size,
              height: size,
              colorType: ColorType.RGBA_8888,
              alphaType: AlphaType.Unpremul,
            });
            if (!pixels || pixels instanceof Float32Array) return null;
            return pixels;
          } finally {
            snapshot.dispose();
          }
        } finally {
          paint.dispose();
        }
      } finally {
        surface.dispose();
      }
    } finally {
      source.dispose();
    }
  } catch {
    return null;
  } finally {
    encoded?.dispose();
  }
}

export async function extractArtworkAccent(
  artworkUri: string,
  method: CoverArtAccentMethod,
  target?: AdaptiveAccentTarget,
): Promise<string | null> {
  if (!artworkUri) return null;
  const pixels = await readArtworkPixels(artworkUri, SAMPLE_SIZE);
  return pixels ? extractArtworkAccentFromPixels(pixels, method, target) : null;
}

export async function extractArtworkField(
  artworkUri: string,
  isDark: boolean,
): Promise<ArtworkField | null> {
  if (!artworkUri) return null;
  const pixels = await readArtworkPixels(artworkUri, FIELD_SAMPLE_SIZE);
  return pixels ? fieldFromPixels(pixels, isDark) : null;
}

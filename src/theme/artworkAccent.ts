import {
  AlphaType,
  ColorType,
  Skia,
  rect,
  type SkData,
} from '@shopify/react-native-skia';
import {
  artworkColorsFromPixels,
  type ArtworkAccentRequest,
  type ArtworkColors,
} from './artworkColors';

/** Callers pass the 128px thumbnail; reading it back at its own size costs no resample. */
const SAMPLE_SIZE = 128;

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

/** Accent and backdrop field for a cover, from one small decode and one clustering pass. */
export async function extractArtworkColors(
  artworkUri: string,
  accent: ArtworkAccentRequest | null,
  isDark: boolean,
): Promise<ArtworkColors | null> {
  if (!artworkUri) return null;
  const pixels = await readArtworkPixels(artworkUri, SAMPLE_SIZE);
  return pixels ? artworkColorsFromPixels(pixels, accent, isDark) : null;
}

import {
  AlphaType,
  ColorType,
  Skia,
  rect,
  type SkData,
} from '@shopify/react-native-skia';
import type { CoverArtAccentMethod } from '@/stores/themeStore';
import { extractArtworkAccentFromPixels } from './artworkAccentMath';

const SAMPLE_SIZE = 128;

async function encodedArtworkData(uri: string) {
  const dataUrl = /^data:[^;,]+;base64,(.+)$/s.exec(uri);
  return dataUrl
    ? Skia.Data.fromBase64(dataUrl[1])
    : Skia.Data.fromURI(uri);
}

export async function extractArtworkAccent(
  artworkUri: string,
  method: CoverArtAccentMethod,
): Promise<string | null> {
  if (!artworkUri) return null;
  let encoded: SkData | null = null;
  try {
    encoded = await encodedArtworkData(artworkUri);
    const source = Skia.Image.MakeImageFromEncoded(encoded);
    if (!source) return null;
    try {
      const surface = Skia.Surface.MakeOffscreen(SAMPLE_SIZE, SAMPLE_SIZE);
      if (!surface) return null;
      try {
        const paint = Skia.Paint();
        try {
          surface.getCanvas().drawImageRect(
            source,
            rect(0, 0, source.width(), source.height()),
            rect(0, 0, SAMPLE_SIZE, SAMPLE_SIZE),
            paint,
          );
          surface.flush();
          const snapshot = surface.makeImageSnapshot();
          try {
            const pixels = snapshot.readPixels(0, 0, {
              width: SAMPLE_SIZE,
              height: SAMPLE_SIZE,
              colorType: ColorType.RGBA_8888,
              alphaType: AlphaType.Unpremul,
            });
            if (!pixels || pixels instanceof Float32Array) return null;
            return extractArtworkAccentFromPixels(pixels, method);
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

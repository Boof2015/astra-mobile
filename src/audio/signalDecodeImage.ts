import { EncodingType, readAsStringAsync } from 'expo-file-system/legacy';
import { AlphaType, ColorType, Skia, rect, type SkImage } from '@shopify/react-native-skia';
import {
  decodeSignalImage,
  type SignalDecodeResult,
  type SignalPayload,
} from '@boof2015/astra-signal';
import {
  signalGuideCaptureSourceRect,
  type SignalImageRect,
  type SignalImageSize,
} from './signalScanGeometry';

const MAX_DIM = 2048;

export interface DecodeSignalFromUriOptions {
  /** Camera preview size used to map the on-screen guide into the full photo. */
  previewSize?: SignalImageSize;
}

function fullRect(source: SkImage): SignalImageRect {
  return { x: 0, y: 0, width: source.width(), height: source.height() };
}

function decodeRect(source: SkImage, crop: SignalImageRect): SignalDecodeResult {
  const scale = Math.min(1, MAX_DIM / Math.max(crop.width, crop.height));
  const width = Math.max(1, Math.round(crop.width * scale));
  const height = Math.max(1, Math.round(crop.height * scale));
  const surface = Skia.Surface.MakeOffscreen(width, height);
  if (!surface) throw new Error('Could not process that image.');
  const paint = Skia.Paint();
  const canvas = surface.getCanvas();
  canvas.drawImageRect(
    source,
    rect(crop.x, crop.y, crop.width, crop.height),
    rect(0, 0, width, height),
    paint
  );
  surface.flush();
  const snapshot = surface.makeImageSnapshot();
  const pixels = snapshot.readPixels(0, 0, {
    width,
    height,
    colorType: ColorType.RGBA_8888,
    alphaType: AlphaType.Unpremul,
  });
  paint.dispose();
  snapshot.dispose();
  surface.dispose();
  if (!pixels) throw new Error('Could not read image pixels.');
  return decodeSignalImage({ data: pixels, width, height });
}

function logDiagnostics(result: SignalDecodeResult, source: 'guide' | 'full'): void {
  if (!__DEV__) return;
  console.debug('[Astra Signal] decoded image', {
    source,
    tier: result.tier,
    correctedBytes: result.correctedBytes,
    erasedBytes: result.erasedBytes,
    confidence: result.confidence,
  });
}

export async function decodeSignalFromUri(
  uri: string,
  options: DecodeSignalFromUriOptions = {}
): Promise<SignalPayload> {
  const b64 = await readAsStringAsync(uri, { encoding: EncodingType.Base64 });
  const encoded = Skia.Data.fromBase64(b64);
  const source = Skia.Image.MakeImageFromEncoded(encoded);
  encoded.dispose();
  if (!source) throw new Error('Could not read that image.');

  try {
    const crop = options.previewSize
      ? signalGuideCaptureSourceRect(
          { width: source.width(), height: source.height() },
          options.previewSize
        )
      : null;
    if (crop) {
      try {
        const result = decodeRect(source, crop);
        logDiagnostics(result, 'guide');
        return result.payload;
      } catch (error) {
        if (__DEV__) console.debug('[Astra Signal] guide decode failed', error);
        // The guide crop is a fast, high-resolution first attempt. Full-image
        // search below handles framing mismatch and images picked from storage.
      }
    }
    try {
      const result = decodeRect(source, fullRect(source));
      logDiagnostics(result, 'full');
      return result.payload;
    } catch (error) {
      if (__DEV__) console.debug('[Astra Signal] full-image decode failed', error);
      throw error;
    }
  } finally {
    source.dispose();
  }
}

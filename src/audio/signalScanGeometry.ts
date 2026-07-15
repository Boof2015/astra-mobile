export interface SignalImageSize {
  width: number;
  height: number;
}

export interface SignalImageRect extends SignalImageSize {
  x: number;
  y: number;
}

// The visible frame describes the common small tier plus the real isolation
// padding used by the mobile presentation, rather than only the black envelope.
export const SIGNAL_SCAN_GUIDE = {
  horizontalInset: 0.06,
  top: 0.32,
  aspectRatio: 2.65,
} as const;

const OPTICAL_SEARCH_ASPECT = 228 / 40;

/**
 * The visible guide is not a crop boundary. Capture the entire preview width
 * while keeping the vertical band bounded. A large first-pass bitmap can leave
 * too much allocation pressure for the full-image fallback on a phone.
 */
export function signalGuideCapturePreviewRect(preview: SignalImageSize): SignalImageRect | null {
  if (preview.width <= 0 || preview.height <= 0) return null;
  const guideWidth = preview.width * (1 - SIGNAL_SCAN_GUIDE.horizontalInset * 2);
  const guideHeight = guideWidth / SIGNAL_SCAN_GUIDE.aspectRatio;
  const guideCenterY = preview.height * SIGNAL_SCAN_GUIDE.top + guideHeight / 2;
  const searchHeight = (guideWidth / OPTICAL_SEARCH_ASPECT) * 3;
  const y0 = Math.max(0, guideCenterY - searchHeight / 2);
  const y1 = Math.min(preview.height, guideCenterY + searchHeight / 2);
  return { x: 0, y: y0, width: preview.width, height: y1 - y0 };
}

/** Map the expanded visible-preview search band into the captured photo. */
export function signalGuideCaptureSourceRect(
  source: SignalImageSize,
  preview: SignalImageSize
): SignalImageRect | null {
  const capture = signalGuideCapturePreviewRect(preview);
  if (!capture || source.width <= 0 || source.height <= 0) return null;
  const coverScale = Math.max(preview.width / source.width, preview.height / source.height);
  const overflowX = (source.width * coverScale - preview.width) / 2;
  const overflowY = (source.height * coverScale - preview.height) / 2;
  const x0 = Math.max(0, (capture.x + overflowX) / coverScale);
  const y0 = Math.max(0, (capture.y + overflowY) / coverScale);
  const x1 = Math.min(source.width, (capture.x + capture.width + overflowX) / coverScale);
  const y1 = Math.min(source.height, (capture.y + capture.height + overflowY) / coverScale);
  if (x1 - x0 < 2 || y1 - y0 < 2) return null;
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}

/**
 * Geometry for the full-screen artwork viewer opened from a detail hero.
 *
 * The viewer never animates layout. Its frame is laid out once at the target
 * rect, and the travel from the hero square is expressed as a transform on a
 * clipping view plus a counter-transform on the image inside it, so a
 * center-cropped square can open into the uncropped cover without a jump.
 *
 * Every function a worklet calls carries its own `'worklet'` directive and is
 * declared above its callers.
 */

export interface ArtworkViewerOrigin {
  /** Window coordinates of the hero artwork at the moment it was tapped. */
  x: number;
  y: number;
  size: number;
  radius: number;
}

export interface ArtworkViewerRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ArtworkViewerInsets {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

export const ARTWORK_VIEWER_MAX_ZOOM = 4;
export const ARTWORK_VIEWER_DOUBLE_TAP_ZOOM = 2.5;
/** How far a pinch may overshoot either limit before release settles it. */
const ZOOM_OVERSHOOT_MIN = 0.7;
const ZOOM_OVERSHOOT_MAX = ARTWORK_VIEWER_MAX_ZOOM * 1.25;
/** At or below this the image counts as "not zoomed": a drag dismisses. */
export const ARTWORK_VIEWER_ZOOMED_THRESHOLD = 1.01;

/**
 * The image view is laid out this many times larger than the frame and scaled
 * back down. expo-image decodes to the view's layout size, so this buys real
 * detail when zooming while keeping the decode bounded by the screen, however
 * large the source file is.
 */
export const ARTWORK_VIEWER_OVERSAMPLE = 2;

/** Covers wider or taller than this are treated as this, to keep the frame usable. */
const MAX_ASPECT = 4;

/** Finger travel and duration that still count as a tap on the hero artwork. */
const TAP_SLOP = 10;
const TAP_MAX_MS = 350;

/** Drag distance (share of window height) or fling speed that dismisses. */
const DISMISS_DISTANCE_SHARE = 0.14;
const DISMISS_VELOCITY = 900;

function lerp(from: number, to: number, progress: number): number {
  'worklet';
  return from + (to - from) * progress;
}

function clampNumber(value: number, min: number, max: number): number {
  'worklet';
  return Math.min(max, Math.max(min, value));
}

export function normalizeArtworkAspect(width: number, height: number): number {
  if (!(width > 0) || !(height > 0)) return 1;
  return clampNumber(width / height, 1 / MAX_ASPECT, MAX_ASPECT);
}

/** Largest rect of the image's aspect that fits the window's safe area, centered in it. */
export function getArtworkViewerTarget(
  windowWidth: number,
  windowHeight: number,
  insets: ArtworkViewerInsets,
  aspect: number
): ArtworkViewerRect {
  const boxWidth = Math.max(1, windowWidth - insets.left - insets.right);
  const boxHeight = Math.max(1, windowHeight - insets.top - insets.bottom);
  const safeAspect = aspect > 0 ? aspect : 1;
  let width = boxWidth;
  let height = width / safeAspect;
  if (height > boxHeight) {
    height = boxHeight;
    width = height * safeAspect;
  }
  return {
    x: insets.left + (boxWidth - width) / 2,
    y: insets.top + (boxHeight - height) / 2,
    width,
    height,
  };
}

export interface ArtworkTravel {
  translateX: number;
  translateY: number;
  /** Scale of the clipping frame, laid out at the target rect. */
  scaleX: number;
  scaleY: number;
  /** Counter-scale of the oversampled image inside the frame. */
  imageScaleX: number;
  imageScaleY: number;
  /** Border radius in the frame's own (pre-scale) units. */
  radius: number;
}

/**
 * Transforms that place the frame between the hero square (progress 0) and the
 * target rect (progress 1). The frame scales non-uniformly when the cover is
 * not square; the image counter-scales so it always covers the frame at its
 * true aspect, which is exactly the hero's center crop at 0 and the whole
 * image at 1.
 */
export function getArtworkTravel(
  origin: ArtworkViewerOrigin,
  target: ArtworkViewerRect,
  progress: number
): ArtworkTravel {
  'worklet';
  const width = lerp(origin.size, target.width, progress);
  const height = lerp(origin.size, target.height, progress);
  const centerX = lerp(origin.x + origin.size / 2, target.x + target.width / 2, progress);
  const centerY = lerp(origin.y + origin.size / 2, target.y + target.height / 2, progress);
  const scaleX = Math.max(0.0001, width / target.width);
  const scaleY = Math.max(0.0001, height / target.height);
  const cover = Math.max(scaleX, scaleY);
  return {
    translateX: centerX - (target.x + target.width / 2),
    translateY: centerY - (target.y + target.height / 2),
    scaleX,
    scaleY,
    imageScaleX: cover / (ARTWORK_VIEWER_OVERSAMPLE * scaleX),
    imageScaleY: cover / (ARTWORK_VIEWER_OVERSAMPLE * scaleY),
    radius: lerp(origin.radius, 0, progress) / Math.min(scaleX, scaleY),
  };
}

/** Zoom while a pinch is in flight: limits plus a little overshoot. */
export function clampLiveZoom(scale: number): number {
  'worklet';
  return clampNumber(scale, ZOOM_OVERSHOOT_MIN, ZOOM_OVERSHOOT_MAX);
}

/** Zoom the image settles at once fingers lift. */
export function clampRestingZoom(scale: number): number {
  'worklet';
  return clampNumber(scale, 1, ARTWORK_VIEWER_MAX_ZOOM);
}

/**
 * New translation that keeps the content under `focal` fixed while the scale
 * changes by `ratio` (next / previous). `center` is the scale origin.
 */
export function zoomAbout(
  focal: number,
  center: number,
  translation: number,
  ratio: number
): number {
  'worklet';
  return (1 - ratio) * (focal - center) + ratio * translation;
}

/**
 * Translation along one axis, limited so a zoomed image never shows the
 * backdrop on a side it could cover. An image smaller than the window on this
 * axis stays centered.
 */
export function clampPan(
  translation: number,
  targetStart: number,
  targetSize: number,
  scale: number,
  windowSize: number
): number {
  'worklet';
  const scaledSize = targetSize * scale;
  if (scaledSize <= windowSize) return 0;
  const center = targetStart + targetSize / 2;
  const max = scaledSize / 2 - center;
  const min = windowSize - center - scaledSize / 2;
  return clampNumber(translation, min, max);
}

export function shouldDismissDrag(
  translationY: number,
  velocityY: number,
  windowHeight: number
): boolean {
  'worklet';
  if (Math.abs(translationY) > windowHeight * DISMISS_DISTANCE_SHARE) return true;
  // A fling only dismisses in the direction the image was already dragged.
  return Math.abs(velocityY) > DISMISS_VELOCITY && velocityY * translationY > 0;
}

/**
 * How far a dismiss drag has gone: 0 at rest, 1 once the image is half a
 * window away. Fades out as the image zooms in, where a drag pans instead.
 */
export function getDragProgress(
  translationX: number,
  translationY: number,
  scale: number,
  windowHeight: number
): number {
  'worklet';
  const zoomed = clampNumber((scale - 1) / 0.25, 0, 1);
  const distance = Math.sqrt(translationX * translationX + translationY * translationY);
  return clampNumber(distance / Math.max(1, windowHeight * 0.5), 0, 1) * (1 - zoomed);
}

/** Whether a touch that started and ended at these points was a tap, not a scroll. */
export function isArtworkTap(
  startX: number,
  startY: number,
  startMs: number,
  endX: number,
  endY: number,
  endMs: number
): boolean {
  if (endMs - startMs > TAP_MAX_MS) return false;
  return Math.abs(endX - startX) <= TAP_SLOP && Math.abs(endY - startY) <= TAP_SLOP;
}

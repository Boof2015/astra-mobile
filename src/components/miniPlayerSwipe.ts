export type MiniPlayerSwipeDirection = 'previous' | 'next';

export interface MiniPlayerSwipeSample {
  translationX: number;
  velocityX: number;
  mediaWidth: number;
}

export const MINI_PLAYER_SWIPE_DISTANCE_FRACTION = 0.24;
export const MINI_PLAYER_SWIPE_FLICK_VELOCITY = 700;
export const MINI_PLAYER_SWIPE_FLICK_MIN_DISTANCE = 16;

export function miniPlayerSwipeDistance(mediaWidth: number): number {
  'worklet';
  return Math.max(0, mediaWidth) * MINI_PLAYER_SWIPE_DISTANCE_FRACTION;
}

/** Resolve a released horizontal drag into a transport command, if it committed. */
export function resolveMiniPlayerSwipe({
  translationX,
  velocityX,
  mediaWidth,
}: MiniPlayerSwipeSample): MiniPlayerSwipeDirection | null {
  'worklet';
  if (
    !Number.isFinite(translationX) ||
    !Number.isFinite(velocityX) ||
    !Number.isFinite(mediaWidth) ||
    mediaWidth <= 0 ||
    translationX === 0
  ) {
    return null;
  }

  const distanceCommit = Math.abs(translationX) >= miniPlayerSwipeDistance(mediaWidth);
  const sameDirectionFlick =
    Math.abs(translationX) >= MINI_PLAYER_SWIPE_FLICK_MIN_DISTANCE &&
    Math.abs(velocityX) >= MINI_PLAYER_SWIPE_FLICK_VELOCITY &&
    Math.sign(translationX) === Math.sign(velocityX);

  if (!distanceCommit && !sameDirectionFlick) return null;
  return translationX < 0 ? 'next' : 'previous';
}

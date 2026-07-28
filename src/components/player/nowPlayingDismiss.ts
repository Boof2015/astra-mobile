const ADAPTIVE_VELOCITY_ONSET = 1000;
const ADAPTIVE_VELOCITY_RANGE = 4000;
const BASE_STIFFNESS = 240;
const MAX_STIFFNESS = 480;
const BASE_DAMPING = 28;
const MAX_DAMPING = 60;
const MIN_REMAINING_DISTANCE = 120;
const VELOCITY_TRAVEL_DAMPING = 1.35;
const DISMISS_DISTANCE = 140;
const DISMISS_VELOCITY = 1000;

interface NowPlayingDismissSpring {
  velocity: number;
  stiffness: number;
  damping: number;
}

export type NowPlayingPanRelease = 'dismiss' | 'restore';

/**
 * The overlay pan must briefly yield when its body is being replaced. Otherwise
 * RNGH can cancel the old child tree after it has already written a partial
 * translateY, leaving the newly mounted body parked off-screen.
 */
export function shouldEnableNowPlayingPan(
  playerOpen: boolean,
  childSheetOpen: boolean,
  bodySwitching: boolean
): boolean {
  return playerOpen && !childSheetOpen && !bodySwitching;
}

/**
 * Queue/lyrics companion rails own their scroll gestures. A non-finite boundary
 * means there is no companion rail, so the whole phone player remains eligible.
 */
export function shouldStartNowPlayingPan(
  panEnabled: boolean,
  absoluteX: number,
  companionStartX: number
): boolean {
  'worklet';

  if (!panEnabled) return false;
  if (!Number.isFinite(companionStartX)) return true;
  return Number.isFinite(absoluteX) && absoluteX < companionStartX;
}

/**
 * Cancellation is authoritative even if the last event carried a large
 * translation or velocity. Only a successfully ended gesture may dismiss.
 */
export function resolveNowPlayingPanRelease(
  translationY: number,
  velocityY: number,
  success: boolean
): NowPlayingPanRelease {
  'worklet';

  if (!success) return 'restore';
  const distance = Number.isFinite(translationY) ? Math.max(0, translationY) : 0;
  const velocity = Number.isFinite(velocityY) ? Math.max(0, velocityY) : 0;
  return distance > DISMISS_DISTANCE || velocity > DISMISS_VELOCITY
    ? 'dismiss'
    : 'restore';
}

/**
 * Preserve the exact release velocity, then make the spring progressively
 * stronger and more damped for hard flicks so it sheds speed after handoff.
 */
export function resolveNowPlayingDismissSpring(
  velocityY: number,
  remainingDistance: number
): NowPlayingDismissSpring {
  'worklet';

  const velocity = Number.isFinite(velocityY) && velocityY > 0 ? velocityY : 0;
  const excessVelocity = Math.max(0, velocity - ADAPTIVE_VELOCITY_ONSET);
  const adaptiveProgress = 1 - Math.exp(-excessVelocity / ADAPTIVE_VELOCITY_RANGE);
  const safeRemainingDistance = Number.isFinite(remainingDistance)
    ? Math.max(MIN_REMAINING_DISTANCE, remainingDistance)
    : MIN_REMAINING_DISTANCE;
  const adaptiveDamping =
    BASE_DAMPING + (MAX_DAMPING - BASE_DAMPING) * adaptiveProgress;
  // Extreme gesture velocities can otherwise cross the remaining screen travel
  // in a single frame and trip overshootClamping. Scale damping only above that
  // risk boundary so the already-good ordinary flick path remains unchanged.
  const travelDamping =
    velocity > 0 ? (velocity / safeRemainingDistance) * VELOCITY_TRAVEL_DAMPING : 0;

  return {
    velocity,
    stiffness: BASE_STIFFNESS + (MAX_STIFFNESS - BASE_STIFFNESS) * adaptiveProgress,
    damping: Math.max(adaptiveDamping, travelDamping),
  };
}

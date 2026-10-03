import { create } from 'zustand';
import type { PlaybackTarget } from '@/stores/playbackTargetStore';

export type NowPlayingTrackTransitionDirection = 'next' | 'previous';

interface NowPlayingTrackTransitionHint {
  direction: NowPlayingTrackTransitionDirection;
  target: PlaybackTarget;
  issuedAt: number;
}

/**
 * A swipe on the artwork already carried the outgoing cover off screen. The
 * artwork's fade-through takes this once, for the track it was showing, and
 * skips its own exit instead of fading a cover that is no longer there.
 */
interface NowPlayingSwipeHandoff {
  /** The overlay instance that was swiped (the dock and the overlay can both be mounted). */
  owner: string;
  /** Transition key of the track the swipe left. */
  fromKey: string;
  issuedAt: number;
}

interface NowPlayingTrackTransitionStore {
  hint: NowPlayingTrackTransitionHint | null;
  handoff: NowPlayingSwipeHandoff | null;
  markDirection: (
    direction: NowPlayingTrackTransitionDirection,
    target: PlaybackTarget,
  ) => void;
}

const DIRECTION_HINT_LIFETIME_MS = 5_000;
/** Longer than any skip takes to land; a stale handoff must never eat a later exit. */
const SWIPE_HANDOFF_LIFETIME_MS = 2_000;

/**
 * Short-lived transport intent shared by the independently animated Now
 * Playing surfaces. It is session-only and never persisted.
 */
export const useNowPlayingTrackTransitionStore =
  create<NowPlayingTrackTransitionStore>((set) => ({
    hint: null,
    handoff: null,
    markDirection: (direction, target) =>
      set({
        hint: {
          direction,
          target,
          issuedAt: Date.now(),
        },
      }),
  }));

export function markNowPlayingTrackTransitionDirection(
  direction: NowPlayingTrackTransitionDirection,
  target: PlaybackTarget,
): void {
  useNowPlayingTrackTransitionStore.getState().markDirection(direction, target);
}

export function resolveNowPlayingTrackTransitionDirection(
  hint: NowPlayingTrackTransitionHint | null,
  target: PlaybackTarget,
  now = Date.now(),
): NowPlayingTrackTransitionDirection {
  if (
    hint?.target === target &&
    now - hint.issuedAt >= 0 &&
    now - hint.issuedAt <= DIRECTION_HINT_LIFETIME_MS
  ) {
    return hint.direction;
  }
  return 'next';
}

export function markNowPlayingSwipeHandoff(owner: string, fromKey: string): void {
  useNowPlayingTrackTransitionStore.setState({
    handoff: { owner, fromKey, issuedAt: Date.now() },
  });
}

/** Consumes the handoff if it is this owner's, for this outgoing track, and fresh. */
export function takeNowPlayingSwipeHandoff(owner: string, fromKey: string, now = Date.now()): boolean {
  const { handoff } = useNowPlayingTrackTransitionStore.getState();
  if (!handoff || handoff.owner !== owner || handoff.fromKey !== fromKey) return false;
  useNowPlayingTrackTransitionStore.setState({ handoff: null });
  return now - handoff.issuedAt >= 0 && now - handoff.issuedAt <= SWIPE_HANDOFF_LIFETIME_MS;
}

export function clearNowPlayingSwipeHandoff(owner: string): void {
  if (useNowPlayingTrackTransitionStore.getState().handoff?.owner !== owner) return;
  useNowPlayingTrackTransitionStore.setState({ handoff: null });
}

import { create } from 'zustand';
import type { PlaybackTarget } from '@/stores/playbackTargetStore';

export type NowPlayingTrackTransitionDirection = 'next' | 'previous';

interface NowPlayingTrackTransitionHint {
  direction: NowPlayingTrackTransitionDirection;
  target: PlaybackTarget;
  issuedAt: number;
}

interface NowPlayingTrackTransitionStore {
  hint: NowPlayingTrackTransitionHint | null;
  markDirection: (
    direction: NowPlayingTrackTransitionDirection,
    target: PlaybackTarget,
  ) => void;
}

const DIRECTION_HINT_LIFETIME_MS = 5_000;

/**
 * Short-lived transport intent shared by the independently animated Now
 * Playing surfaces. It is session-only and never persisted.
 */
export const useNowPlayingTrackTransitionStore =
  create<NowPlayingTrackTransitionStore>((set) => ({
    hint: null,
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

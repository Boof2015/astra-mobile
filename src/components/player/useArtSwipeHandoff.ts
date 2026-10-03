import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { withTiming, type SharedValue } from 'react-native-reanimated';
import { skipToNext, skipToPreviousTrack } from '@/audio/playbackController';
import type { NowPlayingArtCover } from '@/components/player/NowPlayingArtCarousel';
import { predictNeighborArtCover } from '@/components/player/nowPlayingArtNeighbors';
import { playHaptic } from '@/lib/haptics';
import { motion } from '@/theme/motion';

/**
 * No track change by then (end of queue, a failed skip) slides the predicted
 * cover back out and the real one back in.
 */
const ART_SWIPE_HANDOFF_TIMEOUT_MS = 1200;

export interface ArtSwipePrediction {
  /** Transition key of the track the swipe left; the prediction only applies while it is current. */
  fromKey: string;
  cover: NowPlayingArtCover;
  direction: 1 | -1;
}

/**
 * Swipe-to-skip on now-playing's cover, from the commit to the landing. A
 * commit predicts the neighbor from the queue mirror so the carousel slides it
 * in at once, before the skip lands, and holds that prediction until the real
 * track arrives or the timeout gives up on it.
 *
 * Its own hook so the overlay compiles: the bookkeeping lives in refs, and the
 * overlay's gesture is built during render. A gesture callback that reached
 * those refs directly made the React Compiler skip the whole overlay.
 */
export function useArtSwipeHandoff(
  transitionTrackKey: string,
  artSwipeX: SharedValue<number>
): {
  artPrediction: ArtSwipePrediction | null;
  commitArtSwipe: (direction: 'next' | 'previous') => void;
} {
  const [artPrediction, setArtPrediction] = useState<ArtSwipePrediction | null>(null);
  const swipePendingRef = useRef<{ fromKey: string; timer: ReturnType<typeof setTimeout> } | null>(null);
  const transitionKeyRef = useRef(transitionTrackKey);

  const rejectArtSwipe = useCallback(() => {
    const pending = swipePendingRef.current;
    if (pending) clearTimeout(pending.timer);
    swipePendingRef.current = null;
    // Dropping the prediction returns the carousel to the real track, which
    // reverses the slide it just made.
    setArtPrediction(null);
    artSwipeX.set(withTiming(0, motion.quick));
    playHaptic('reject');
  }, [artSwipeX]);

  const commitArtSwipe = useCallback((direction: 'next' | 'previous') => {
    if (swipePendingRef.current) return;
    const fromKey = transitionKeyRef.current;
    const neighbor = predictNeighborArtCover(direction);
    if (neighbor) {
      setArtPrediction({ fromKey, cover: neighbor, direction: direction === 'next' ? 1 : -1 });
    }
    const timer = setTimeout(() => {
      if (swipePendingRef.current?.timer === timer) rejectArtSwipe();
    }, ART_SWIPE_HANDOFF_TIMEOUT_MS);
    swipePendingRef.current = { fromKey, timer };
    // Previous always means the previous *track* here: its cover is already on
    // screen, so restarting the song instead would show the wrong one.
    const command = direction === 'next' ? skipToNext() : skipToPreviousTrack();
    void command.catch(() => {
      if (swipePendingRef.current?.timer === timer) rejectArtSwipe();
    });
  }, [rejectArtSwipe]);

  // The new track has landed. The prediction is keyed to the track it left, so
  // it already stopped applying; clear it so returning to that track later
  // can't revive it.
  useLayoutEffect(() => {
    transitionKeyRef.current = transitionTrackKey;
    const pending = swipePendingRef.current;
    if (!pending || pending.fromKey === transitionTrackKey) return;
    clearTimeout(pending.timer);
    swipePendingRef.current = null;
    queueMicrotask(() => setArtPrediction(null));
    // The carousel (a child, so its effect ran first) took any drag offset. The
    // rack face has no carousel; bring it home.
    if (artSwipeX.get() !== 0) artSwipeX.set(withTiming(0, motion.quick));
    playHaptic('confirm');
  }, [artSwipeX, transitionTrackKey]);

  useEffect(() => () => {
    const pending = swipePendingRef.current;
    if (pending) clearTimeout(pending.timer);
  }, []);

  return { artPrediction, commitArtSwipe };
}

import { useEffect, useRef } from 'react';
import {
  Easing,
  ReduceMotion,
  cancelAnimation,
  useSharedValue,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import {
  reconcilePlaybackProgress,
  type PlaybackProgressSnapshot,
} from './playbackProgressProjection';

/**
 * Reconciles coarse RNTP snapshots while projecting the visible progress
 * continuously on Reanimated's UI thread.
 */
export function useAnimatedPlaybackProgress(
  snapshot: PlaybackProgressSnapshot
): SharedValue<number> {
  const {
    active,
    currentTime,
    duration,
    isPlaying,
    overrideFraction,
    trackKey,
  } = snapshot;
  const initial = reconcilePlaybackProgress(snapshot);
  const progress = useSharedValue(initial.fraction);
  const previousTrackKey = useRef(trackKey);

  useEffect(() => {
    const command = reconcilePlaybackProgress(
      {
        active,
        currentTime,
        duration,
        isPlaying,
        overrideFraction,
        trackKey,
      },
      previousTrackKey.current
    );
    previousTrackKey.current = trackKey;
    cancelAnimation(progress);
    progress.value = command.fraction;
    if (command.animate) {
      progress.value = withTiming(1, {
        duration: command.animationDurationMs,
        easing: Easing.linear,
        reduceMotion: ReduceMotion.Never,
      });
    }
  }, [
    progress,
    active,
    currentTime,
    duration,
    isPlaying,
    overrideFraction,
    trackKey,
  ]);

  useEffect(() => () => cancelAnimation(progress), [progress]);
  return progress;
}

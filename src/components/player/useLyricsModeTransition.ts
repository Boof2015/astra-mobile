import { useEffect, useLayoutEffect, useReducer, useState } from 'react';
import { AccessibilityInfo } from 'react-native';
import {
  Easing,
  ReduceMotion,
  cancelAnimation,
  runOnJS,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import {
  initialLyricsModeTransition,
  LYRICS_MODE_ENTER_MS,
  LYRICS_MODE_EXIT_MS,
  reduceLyricsModeTransition,
} from './lyricsModeTransition';

export function useLyricsModeTransition(requested: boolean, active: boolean) {
  const initialReducedMotion = useReducedMotion();
  const [reducedMotion, setReducedMotion] = useState(initialReducedMotion);
  const [state, dispatch] = useReducer(
    reduceLyricsModeTransition,
    requested,
    initialLyricsModeTransition,
  );
  const opacity = useSharedValue(1);
  const animate = active && !reducedMotion;

  useEffect(() => {
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', setReducedMotion);
    return () => subscription.remove();
  }, []);

  // Closed/backgrounded players and presentation changes settle immediately.
  // No animation callback is allowed to bring back an obsolete body later.
  useLayoutEffect(() => {
    dispatch({ type: 'request', lyrics: requested, animate });
  }, [requested, animate]);

  useLayoutEffect(() => {
    cancelAnimation(opacity);
    if (state.phase === 'idle') {
      opacity.value = 1;
      return undefined;
    }

    const exiting = state.phase === 'exiting';
    const duration = exiting ? LYRICS_MODE_EXIT_MS : LYRICS_MODE_ENTER_MS;
    const target = exiting ? 0 : 1;
    let cancelled = false;
    const complete = () => {
      if (!cancelled) {
        dispatch({ type: exiting ? 'hidden' : 'visible', generation: state.generation });
      }
    };
    opacity.value = withTiming(target, {
      duration,
      easing: exiting ? Easing.in(Easing.cubic) : Easing.out(Easing.cubic),
      reduceMotion: ReduceMotion.System,
    }, (finished) => {
      if (finished) runOnJS(complete)();
    });
    // Native cancellation must never strand a transparent body or a disabled
    // dismiss gesture. The normal UI-thread callback always beats this backstop.
    const timer = setTimeout(() => {
      cancelAnimation(opacity);
      opacity.value = target;
      complete();
    }, duration + 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      cancelAnimation(opacity);
    };
  }, [state.generation, state.phase, opacity]);

  const style = useAnimatedStyle(() => ({ opacity: opacity.value }));
  return {
    displayed: state.displayed,
    switching: state.phase !== 'idle' || requested !== state.displayed,
    style,
  };
}

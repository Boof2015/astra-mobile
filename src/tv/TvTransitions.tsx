import { useEffect, type ReactNode } from 'react';
import { StyleSheet } from 'react-native';
import Animated, { cancelAnimation, Easing, FadeIn, FadeInDown, FadeInRight, FadeOut, FadeOutRight, LinearTransition, ReduceMotion, runOnJS, useAnimatedStyle, useReducedMotion, useSharedValue, withDelay, withTiming } from 'react-native-reanimated';

// Short, interruptible UI-thread transitions. Focus/navigation never waits for
// the visuals, and the system's reduced-motion preference removes the motion.
export const tvEnter = FadeIn.duration(180).reduceMotion(ReduceMotion.System);
export const tvExit = FadeOut.duration(100).reduceMotion(ReduceMotion.System);
export const TV_PLAYER_EXIT_MS = 260;
// Keep the React tree through dismissal so its controls can be deactivated
// immediately. A native exit snapshot would retain their old focusable props.
export function useTvPlayerTransition(open: boolean, closed: () => void, opened: () => void) {
  const progress = useSharedValue(0);
  useEffect(() => {
    // Give the native focus/layout handoff a frame before starting the clock;
    // its first draw must not consume the entrance or exit's animation time.
    progress.value = withDelay(17, withTiming(open ? 1 : 0, {
      duration: open ? 320 : TV_PLAYER_EXIT_MS,
      easing: open ? Easing.out(Easing.quad) : Easing.inOut(Easing.quad),
      reduceMotion: ReduceMotion.System,
    }, finished => { if (finished) runOnJS(open ? opened : closed)(); }), ReduceMotion.System);
    return () => cancelAnimation(progress);
  }, [open, closed, opened, progress]);
  return useAnimatedStyle(() => ({ opacity: progress.value, transform: [{ translateY: (1 - progress.value) * 25 }] }));
}
export const tvPanelEnter = FadeInDown.duration(160).easing(Easing.out(Easing.cubic))
  .withInitialValues({ opacity: 0, transform: [{ translateY: 8 }] }).reduceMotion(ReduceMotion.System);
export const tvQueueEnter = FadeInRight.duration(180).easing(Easing.out(Easing.cubic))
  .withInitialValues({ opacity: 0, transform: [{ translateX: 18 }] }).reduceMotion(ReduceMotion.System);
export const tvQueueExit = FadeOutRight.duration(120).withInitialValues({ opacity: 1, transform: [{ translateX: 0 }] }).reduceMotion(ReduceMotion.System);
export const tvLayout = LinearTransition.duration(200).easing(Easing.out(Easing.cubic)).reduceMotion(ReduceMotion.System);

// Lyrics rearranges the whole player; give that larger movement time to read.
export const tvLyricsEnter = FadeIn.duration(300).reduceMotion(ReduceMotion.System);
export const tvLyricsExit = FadeOut.duration(200).reduceMotion(ReduceMotion.System);
export const tvLyricsLayout = LinearTransition.duration(300).easing(Easing.out(Easing.quad)).reduceMotion(ReduceMotion.System);

/** Kept-alive pages retain their scroll/focus memory. Only the incoming page
 * draws; no duplicate focus tree or delayed navigation is needed. */
export function TvScene({ visible, children }: { visible: boolean; children: ReactNode }) {
  const reduced = useReducedMotion();
  const opacity = useSharedValue(0);
  useEffect(() => { opacity.value = visible ? withTiming(1, { duration: reduced ? 0 : 180 }) : 0; }, [visible, reduced, opacity]);
  const style = useAnimatedStyle(() => ({ opacity: opacity.value, transform: [{ translateY: reduced ? 0 : (1 - opacity.value) * 6 }] }));
  return <Animated.View style={[StyleSheet.absoluteFill, style, { display: visible ? 'flex' : 'none' }]}>{children}</Animated.View>;
}

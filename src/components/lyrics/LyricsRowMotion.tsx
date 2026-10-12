import { memo, type ReactNode } from 'react';
import { type LayoutChangeEvent } from 'react-native';
import Animated, { cancelAnimation, Easing, useAnimatedReaction, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { MOBILE_LYRICS_MOTION, MOBILE_NATIVE_SCROLL_MS, lyricOpacity, mobileLyricRipple, mobileLyricStagger } from '@/lyrics/animation';
import { LYRICS_EASE, type LyricsScrollMotion } from './useLyricsFollow';

/** Native scrolling handles touch and accessibility. A short per-row offset
 * retains the flowing stagger without the TV's long trailing movement. */
export const LyricsRowMotion = memo(function LyricsRowMotion({
  index, motion, opacity: idleOpacity, current, gap, nearby, browsing, reduced, right, spacing, onLayout, children,
}: {
  index: number; motion: LyricsScrollMotion; opacity: number; current: boolean; gap: boolean;
  nearby: boolean; browsing: boolean; reduced: boolean; right: boolean; spacing: number;
  onLayout: (event: LayoutChangeEvent) => void; children: ReactNode;
}) {
  const elapsed = useSharedValue(0);
  const delta = useSharedValue(0);
  const delay = useSharedValue(0);
  const release = useSharedValue(0);
  const targetOpacity = browsing && !current ? .72 : gap && current ? .9 : idleOpacity;
  const targetScale = browsing || current || reduced ? 1 : MOBILE_LYRICS_MOTION.inactiveScale;
  const opacity = useSharedValue(targetOpacity);
  const scale = useSharedValue(targetScale);
  useAnimatedReaction(() => nearby ? { command: motion.command.value, cue: motion.cue.value, started: motion.started.value } : null, (next, previous) => {
    if (next === null) {
      cancelAnimation(elapsed);
      cancelAnimation(release);
      delta.value = 0;
      release.value = 0;
      return;
    }
    const following = next.command.mode === 'follow';
    const isCurrent = index === next.cue.current || gap && index === next.cue.focus;
    const cueDistance = index - next.cue.focus;
    opacity.value = withTiming(!following && !isCurrent ? .72 : gap && isCurrent ? .9 : lyricOpacity(cueDistance, isCurrent),
      { duration: reduced ? 0 : MOBILE_LYRICS_MOTION.emphasisMs, easing: LYRICS_EASE });
    scale.value = withTiming(!following || isCurrent || reduced ? 1 : MOBILE_LYRICS_MOTION.inactiveScale,
      { duration: reduced ? 0 : MOBILE_LYRICS_MOTION.moveMs, easing: LYRICS_EASE });
    if (next.command !== previous?.command) {
      // Preserve the visible offset when a cue or drag interrupts the wave.
      const carried = release.value + mobileLyricRipple(delta.value, elapsed.value, delay.value);
      cancelAnimation(elapsed);
      cancelAnimation(release);
      elapsed.value = 0;
      delta.value = !reduced && following && next.command.stagger ? next.command.target - next.command.from : 0;
      delay.value = mobileLyricStagger(cueDistance);
      release.value = reduced || following && !next.command.animate ? 0 : carried;
      release.value = withTiming(0, { duration: reduced ? 0 : MOBILE_LYRICS_MOTION.releaseMs, easing: LYRICS_EASE });
    }
    if (delta.value !== 0 && delay.value > 0 && next.started === next.command.generation
      && (next.started !== previous?.started || next.command !== previous?.command)) {
      const duration = MOBILE_NATIVE_SCROLL_MS + delay.value;
      elapsed.value = withTiming(duration, { duration, easing: Easing.linear });
    }
  }, [motion, index, gap, nearby, reduced]);

  const style = useAnimatedStyle(() => {
    if (!nearby) return { opacity: targetOpacity, transform: [{ translateY: 0 }, { scale: targetScale }] };
    const y = release.value + mobileLyricRipple(delta.value, elapsed.value, delay.value);
    return { opacity: opacity.value, transform: [{ translateY: y }, { scale: scale.value }] };
  });
  return <Animated.View onLayout={onLayout} renderToHardwareTextureAndroid={nearby}
    style={[{ width: '100%', paddingBottom: spacing, transformOrigin: right ? 'right center' : 'left center' }, style]}>
    {children}
  </Animated.View>;
});

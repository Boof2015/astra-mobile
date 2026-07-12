// Native android_ripple configs — touch feedback drawn by the Android render
// thread the frame the finger lands, independent of JS-thread load. This is
// the app's ONE press-feedback system: JS `({ pressed })` dim styles were
// removed in its favor (persistent selected/active styles are state, not
// feedback, and stay).

import { useMemo } from 'react';
import type { PressableAndroidRippleConfig } from 'react-native';
import { useColors } from '@/theme/themed';

/**
 * Fixed light overlay for accent-filled buttons — the theme `ripple` token is
 * invisible on a saturated accent fill. Theme-invariant on purpose (Material's
 * on-color ripple), so it is not a palette token.
 */
const ON_ACCENT_COLOR = 'rgba(255, 255, 255, 0.24)';

/**
 * `unstable_pressDelay` for Pressables inside SCROLLABLE content (rows, tiles,
 * sheet items): a scroll flick claims the touch before the delay elapses, so
 * scrolling never flashes ripples on everything it grazes — mirroring Android's
 * ViewConfiguration tap timeout in native lists. Quick real taps still ripple
 * (RN fires press-in/out on release even under the delay). Fixed chrome
 * (tab bar, transport, action bars) stays instant — no delay there.
 */
export const SCROLL_PRESS_DELAY = 80;

export interface RippleSet {
  /** Clips to the Pressable rect/borderRadius — rows, cards, pills, sheet items. */
  bounded: PressableAndroidRippleConfig;
  /** Bounded but drawn ABOVE children — tiles/cards whose artwork covers the Pressable. */
  tile: PressableAndroidRippleConfig;
  /** Circular unbounded ripple for transparent icon buttons; radius ≈ half the touch target. */
  icon: (radius: number) => PressableAndroidRippleConfig;
  /** Light overlay for accent-filled buttons (bounded unless a radius is given). */
  onAccent: (radius?: number) => PressableAndroidRippleConfig;
}

export function useRipple(): RippleSet {
  const colors = useColors();
  return useMemo(
    () => ({
      bounded: { color: colors.ripple },
      tile: { color: colors.ripple, foreground: true },
      icon: (radius: number) => ({ color: colors.ripple, borderless: true, radius }),
      onAccent: (radius?: number) =>
        radius == null
          ? { color: ON_ACCENT_COLOR, foreground: true }
          : { color: ON_ACCENT_COLOR, borderless: true, radius },
    }),
    [colors.ripple]
  );
}

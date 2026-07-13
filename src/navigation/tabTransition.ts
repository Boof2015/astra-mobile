/**
 * Bottom tabs use React Native's legacy native Animated driver. On Android,
 * timing animations are pre-sampled at 60 fps, so their positions repeat on a
 * 120 Hz display. A critically damped native spring is evaluated from each
 * display frame instead while preserving the current ~160 ms ease-out feel.
 */
export const TAB_TRANSITION_SETTLE_MS = 160;

export const TAB_TRANSITION_SPEC = {
  animation: 'spring',
  config: {
    stiffness: 2500,
    damping: 100,
    mass: 1,
    overshootClamping: true,
    restDisplacementThreshold: 0.004,
    restSpeedThreshold: 0.15,
  },
} as const;


/**
 * Bottom tabs use React Native's legacy native Animated driver. On Android,
 * timing animations are pre-sampled at 60 fps. A short, critically damped
 * native spring avoids translating two retained full-page scenes and leaves
 * only an intentional cross-fade at the tab boundary.
 */
export const TAB_TRANSITION_SETTLE_MS = 160;
export const TAB_SCENE_ANIMATION = 'fade' as const;

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

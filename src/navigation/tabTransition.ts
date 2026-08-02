/**
 * Bottom tabs use React Native's legacy native Animated driver. On Android,
 * timing animations are pre-sampled at 60 fps. A short, critically damped
 * native spring avoids translating two retained full-page scenes and leaves
 * only an intentional cross-fade at the tab boundary.
 */
export const TAB_TRANSITION_SETTLE_MS = 160;
export const TAB_SCENE_ANIMATION = 'fade' as const;

/**
 * Presses inside this window are swallowed so the native-driver fade is never
 * interrupted. Was inlined at the press handler; named here so the reset delay
 * below can be stated in terms of it.
 */
export const TAB_PRESS_SWALLOW_MS = TAB_TRANSITION_SETTLE_MS + 30;

/**
 * When the tab being *left* has its nested stack rewound to its root.
 *
 * Must stay under `TAB_PRESS_SWALLOW_MS` so a rewind can never land after the
 * next press has already been accepted, and over `TAB_TRANSITION_SETTLE_MS` so
 * the scene it pops is already faded out when the removal animates.
 */
export const TAB_STACK_RESET_DELAY_MS = TAB_TRANSITION_SETTLE_MS + 10;

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

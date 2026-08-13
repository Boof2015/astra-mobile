import type {
  BottomTabNavigationOptions,
  BottomTabSceneStyleInterpolator,
} from 'expo-router/build/react-navigation/bottom-tabs/types';

/**
 * Bottom tabs use React Native's legacy native Animated driver. On Android,
 * timing animations are pre-sampled at 60 fps. A short, critically damped
 * native spring keeps the retained full-page scenes moving smoothly while a
 * very short shared-axis drift gives their order a spatial relationship.
 */
export const TAB_TRANSITION_SETTLE_MS = 160;
export const TAB_SCENE_ANIMATION = 'fade' as const;
export const TAB_SCENE_TRANSLATION_DP = 20;

/**
 * Navigator order is motion order. Stats is a hidden, Home-owned destination,
 * so it lives immediately after Home: leaving Stats for Library must still
 * read as a forward trip from the visibly selected Home item.
 */
export const TAB_ROUTE_ORDER = ['index', 'stats', 'library', 'eq', 'settings'] as const;

export const TAB_SCENE_PROGRESS_RANGE = [-1, 0, 1] as const;
export const TAB_SCENE_OPACITY_RANGE = [0, 1, 0] as const;
export const TAB_SCENE_TRANSLATION_RANGE = [
  -TAB_SCENE_TRANSLATION_DP,
  0,
  TAB_SCENE_TRANSLATION_DP,
] as const;

/**
 * React Navigation assigns negative progress to routes before the focused
 * destination and positive progress to routes after it. Mapping that value
 * directly to translation makes forward and reverse trips mirror one another.
 */
export const TAB_SCENE_STYLE_INTERPOLATOR: BottomTabSceneStyleInterpolator = ({ current }) => ({
  sceneStyle: {
    opacity: current.progress.interpolate({
      inputRange: [...TAB_SCENE_PROGRESS_RANGE],
      outputRange: [...TAB_SCENE_OPACITY_RANGE],
    }),
    transform: [
      {
        translateX: current.progress.interpolate({
          inputRange: [...TAB_SCENE_PROGRESS_RANGE],
          outputRange: [...TAB_SCENE_TRANSLATION_RANGE],
        }),
      },
    ],
  },
});

export type TabSceneMotionOptions = Pick<
  BottomTabNavigationOptions,
  'animation' | 'sceneStyleInterpolator' | 'transitionSpec'
>;

export function resolveTabSceneMotion(reducedMotion: boolean): TabSceneMotionOptions {
  if (reducedMotion) return { animation: 'none' };
  return {
    animation: TAB_SCENE_ANIMATION,
    sceneStyleInterpolator: TAB_SCENE_STYLE_INTERPOLATOR,
    transitionSpec: TAB_TRANSITION_SPEC,
  };
}

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

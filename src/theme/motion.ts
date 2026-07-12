import { Easing, ReduceMotion } from 'react-native-reanimated';

/**
 * Shared motion curves. Deliberately spring-free: plain ease-out timing so
 * sheets, rows, and snaps settle smoothly without overshoot/bounce (which read
 * as distracting on transport/queue UI). Use these instead of `withSpring`.
 */
export const motion = {
  /** Small, fast settle — swipe spring-back, row snaps. */
  quick: {
    duration: 160,
    easing: Easing.out(Easing.cubic),
    reduceMotion: ReduceMotion.System,
  },
  /** Sheet / snap-point transitions. */
  snap: {
    duration: 220,
    easing: Easing.out(Easing.cubic),
    reduceMotion: ReduceMotion.System,
  },
} as const;

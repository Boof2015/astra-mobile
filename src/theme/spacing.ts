/**
 * Spacing, radius, and layout tokens.
 * Radii match desktop (`--radius-sm/md/lg`); layout dims are adapted for mobile.
 */
export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
} as const;

export const radius = {
  sm: 6,
  md: 10,
  lg: 16,
  pill: 999,
} as const;

export const layout = {
  /** Persistent mini-player bar height (desktop now-playing bar is 112px; trimmed for phone). */
  miniPlayerHeight: 64,
  /** Bottom tab bar content height (excludes safe-area inset, which is added on top). */
  tabBarHeight: 56,
} as const;

export const durations = {
  fast: 150,
  normal: 250,
} as const;

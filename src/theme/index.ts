import { fonts, fontSize, lineHeight } from './typography';
import { spacing, radius, layout, durations } from './spacing';

// Colors are theme-resolved at runtime now — consume them via
// `useColors()` / `createThemedStyles()` from '@/theme/themed'.
// Palette types + base palettes live in '@/theme/palettes'.
export const theme = {
  fonts,
  fontSize,
  lineHeight,
  spacing,
  radius,
  layout,
  durations,
} as const;

export type Theme = typeof theme;

export { fonts, fontSize, lineHeight, spacing, radius, layout, durations };

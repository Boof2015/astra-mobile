import { fonts, fontSize, lineHeight, variantLineHeight, MAX_FONT_SCALE } from './typography';
import { spacing, radius, layout, durations } from './spacing';

// Colors are theme-resolved at runtime now — consume them via
// `useColors()` / `createThemedStyles()` from '@/theme/themed'.
// Palette types + base palettes live in '@/theme/palettes'.
export const theme = {
  fonts,
  fontSize,
  lineHeight,
  variantLineHeight,
  spacing,
  radius,
  layout,
  durations,
} as const;

export type Theme = typeof theme;

export {
  fonts,
  fontSize,
  lineHeight,
  variantLineHeight,
  MAX_FONT_SCALE,
  spacing,
  radius,
  layout,
  durations,
};

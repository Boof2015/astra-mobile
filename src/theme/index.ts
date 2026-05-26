import { colors } from './colors';
import { fonts, fontSize, lineHeight } from './typography';
import { spacing, radius, layout, durations } from './spacing';

export const theme = {
  colors,
  fonts,
  fontSize,
  lineHeight,
  spacing,
  radius,
  layout,
  durations,
} as const;

export type Theme = typeof theme;

export { colors, fonts, fontSize, lineHeight, spacing, radius, layout, durations };

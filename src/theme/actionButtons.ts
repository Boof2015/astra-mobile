import type { TextStyle, ViewStyle } from 'react-native';
import type { Palette } from './palettes';
import { hexToRgb, mixHex } from './colorUtils';
import { fonts } from './typography';
import { spacing } from './spacing';

export type ActionButtonVariant = 'primary' | 'secondary' | 'danger';

/** Shared treatment for labeled actions; each layout still owns its button widths. */
export const actionButtonBase = {
  minHeight: 44,
  borderRadius: 14,
  paddingHorizontal: spacing.lg,
  paddingVertical: spacing.sm,
  flexDirection: 'row',
  alignItems: 'center',
  justifyContent: 'center',
  gap: spacing.sm,
} satisfies ViewStyle;

export const actionButtonLabel = {
  fontFamily: fonts.sans.semibold,
  fontSize: 14,
  lineHeight: 20,
  textAlign: 'center',
  flexShrink: 1,
} satisfies TextStyle;

function luminance(hex: string): number {
  const { r, g, b } = hexToRgb(hex);
  const [red, green, blue] = [r, g, b].map((channel) => {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return red * 0.2126 + green * 0.7152 + blue * 0.0722;
}

/** Accent text tokens are for text *on surfaces*, not for text on the accent itself. */
export function actionButtonForeground(colors: Palette): string {
  const dark = '#080a0f';
  const background = luminance(colors.accent);
  const darkContrast = (background + 0.05) / (luminance(dark) + 0.05);
  const lightContrast = 1.05 / (background + 0.05);
  return darkContrast >= lightContrast ? dark : '#ffffff';
}

export function actionButtonStyle(colors: Palette, variant: ActionButtonVariant): ViewStyle {
  return {
    ...actionButtonBase,
    backgroundColor: variant === 'primary'
      ? colors.accent
      : variant === 'danger'
        ? mixHex(colors.bgTertiary, colors.warning, 0.12)
        : colors.bgTertiary,
  };
}

export function actionButtonTextStyle(colors: Palette, variant: ActionButtonVariant): TextStyle {
  return {
    ...actionButtonLabel,
    color: variant === 'primary'
      ? actionButtonForeground(colors)
      : variant === 'danger' ? colors.warning : colors.textSecondary,
  };
}

export function selectionSurface(colors: Palette): string {
  return mixHex(colors.bgTertiary, colors.accent, 0.22);
}

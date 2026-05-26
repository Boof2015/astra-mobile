import { Text as RNText, type TextProps as RNTextProps, StyleSheet } from 'react-native';
import { colors, fonts, fontSize } from '@/theme';

type Variant = 'title' | 'heading' | 'body' | 'label' | 'caption' | 'mono';

interface TextProps extends RNTextProps {
  variant?: Variant;
  color?: string;
}

/** Themed Text — applies Astra fonts/colors. Import this instead of RN's Text. */
export function Text({ variant = 'body', color, style, ...rest }: TextProps) {
  return (
    <RNText
      style={[styles[variant], color ? { color } : null, style]}
      {...rest}
    />
  );
}

const styles = StyleSheet.create({
  title: {
    fontFamily: fonts.sans.bold,
    fontSize: fontSize.xxl,
    color: colors.textPrimary,
  },
  heading: {
    fontFamily: fonts.sans.semibold,
    fontSize: fontSize.lg,
    color: colors.textPrimary,
  },
  body: {
    fontFamily: fonts.sans.regular,
    fontSize: fontSize.base,
    color: colors.textPrimary,
  },
  label: {
    fontFamily: fonts.sans.medium,
    fontSize: fontSize.sm,
    color: colors.textSecondary,
  },
  caption: {
    fontFamily: fonts.sans.regular,
    fontSize: fontSize.xs,
    color: colors.textTertiary,
  },
  mono: {
    fontFamily: fonts.mono.regular,
    fontSize: fontSize.sm,
    color: colors.textSecondary,
  },
});

export default Text;

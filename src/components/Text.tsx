import type { ReactNode } from 'react';
import {
  Text as RNText,
  type TextProps as RNTextProps
} from 'react-native';
import {
  fonts,
  fontSize,
} from '@/theme';
import { createThemedStyles } from '@/theme/themed';

type Variant = 'title' | 'heading' | 'body' | 'label' | 'caption' | 'mono';

interface TextProps extends RNTextProps {
  variant?: Variant;
  color?: string;
}

// Inter / JetBrains Mono are Latin-only, and a custom TTF Typeface on Android does
// not chain to the system Noto fallback, so CJK/other non-Latin glyphs render blank.
// When a string contains characters outside the ranges Inter actually covers, we drop
// the custom fontFamily so the platform default (full Noto CJK/emoji coverage) renders
// it, keeping the variant's weight via numeric fontWeight.
// Allowed (stays Inter): Latin + Latin-1/Ext-A/B (0000-024F), Greek (0370-03FF),
// Cyrillic (0400-04FF), general punctuation (2000-206F), currency (20A0-20CF),
// letterlike symbols (2100-214F). Anything else -> system font.
const NON_LATIN =
  /[^\u0000-\u024F\u0370-\u03FF\u0400-\u04FF\u2000-\u206F\u20A0-\u20CF\u2100-\u214F]/;

const VARIANT_FAMILY: Record<Variant, string> = {
  title: fonts.sans.bold,
  heading: fonts.sans.semibold,
  body: fonts.sans.regular,
  label: fonts.sans.medium,
  caption: fonts.sans.regular,
  mono: fonts.mono.regular,
};

const VARIANT_WEIGHT: Record<Variant, '400' | '500' | '600' | '700'> = {
  title: '700',
  heading: '600',
  body: '400',
  label: '500',
  caption: '400',
  mono: '400',
};

function collectText(node: ReactNode): string {
  if (typeof node === 'string') return node;
  if (typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(collectText).join('');
  return ''; // nested elements render their own <Text> and self-detect
}

/** Themed Text — applies Astra fonts/colors. Import this instead of RN's Text. */
export function Text({ variant = 'body', color, style, ...rest }: TextProps) {
  const styles = useStyles();
  const fallback = NON_LATIN.test(collectText(rest.children));
  return (
    <RNText
      style={[
        styles[variant],
        {
          fontFamily: fallback ? undefined : VARIANT_FAMILY[variant],
          fontWeight: fallback ? VARIANT_WEIGHT[variant] : undefined,
        },
        color ? { color } : null,
        style,
      ]}
      {...rest}
    />
  );
}

const useStyles = createThemedStyles((colors) => ({
  title: {
    fontSize: fontSize.xxl,
    color: colors.textPrimary,
  },
  heading: {
    fontSize: fontSize.lg,
    color: colors.textPrimary,
  },
  body: {
    fontSize: fontSize.base,
    color: colors.textPrimary,
  },
  label: {
    fontSize: fontSize.sm,
    color: colors.textSecondary,
  },
  caption: {
    fontSize: fontSize.xs,
    color: colors.textTertiary,
  },
  mono: {
    fontSize: fontSize.sm,
    color: colors.textSecondary,
  },
}));

export default Text;

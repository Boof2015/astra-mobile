/**
 * Astra typography tokens.
 * Inter (UI) + JetBrains Mono (numerics / format badges), mirroring desktop.
 * Family strings match the names exposed by @expo-google-fonts packages and
 * loaded via `useFonts` in the root layout.
 */
export const fonts = {
  sans: {
    regular: 'Inter_400Regular',
    medium: 'Inter_500Medium',
    semibold: 'Inter_600SemiBold',
    bold: 'Inter_700Bold',
  },
  mono: {
    regular: 'JetBrainsMono_400Regular',
    medium: 'JetBrainsMono_500Medium',
  },
} as const;

/** Font sizes — base 14 like desktop, scaled up where mobile reading distance needs it. */
export const fontSize = {
  xs: 11,
  sm: 12,
  base: 14,
  md: 16,
  lg: 20,
  xl: 26,
  xxl: 34,
} as const;

export const lineHeight = {
  tight: 1.2,
  normal: 1.5,
} as const;

/**
 * Resolved line box height per text variant, in dp at font scale 1.
 *
 * These are load-bearing, not cosmetic. Without an explicit lineHeight a Text's
 * block height comes from the *font's own* ascent/descent, which differs by OEM
 * and changes again whenever `Text` drops to the system fallback family for
 * non-Latin glyphs. Layouts that reserve space for text (now-playing's control
 * deck) can only be exact if every line box is a number we chose.
 *
 * Anything reserving space for one of these must scale it by the effective font
 * scale — React Native applies `allowFontScaling` to lineHeight as well as
 * fontSize. See `MAX_FONT_SCALE` in components/player/nowPlayingLayout.ts.
 */
export const variantLineHeight = {
  title: 41,
  heading: 26,
  body: 20,
  label: 16,
  caption: 15,
  mono: 16,
} as const;

/**
 * Ceiling on the system font-size setting. Text stays legible up to 1.2x, and
 * every deck row that reserves line boxes can size itself for the worst case.
 */
export const MAX_FONT_SCALE = 1.2;

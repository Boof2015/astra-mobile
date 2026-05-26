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

/**
 * Astra color tokens. Dark-only. M3 redesign shifted the palette from
 * cyan-on-black toward a softer indigo-on-navy "mobile-first" language; these
 * tokens are the single source of truth, so a future theming pass can swap them.
 */
export const colors = {
  // Base backgrounds (navy)
  bgPrimary: '#080a0f',
  bgSecondary: '#0c0f18',
  bgTertiary: '#11162a',

  // Glass / surface overlays (subtle blue-tinted alphas)
  glassBg: 'rgba(124, 146, 196, 0.05)',
  glassBorder: 'rgba(124, 146, 196, 0.16)',
  glassHighlight: 'rgba(140, 162, 208, 0.08)',

  // Text (blue-tinted neutrals)
  textPrimary: '#e2e8f4',
  textSecondary: '#8a98b8',
  textTertiary: '#52607f',

  // Warning amber (desktop .graph-meta-chip-warning)
  warning: '#f3d27d',

  // Indigo accent
  accent: '#5b8aff',
  accentHover: '#82a6ff',
  accentGlow: 'rgba(91, 138, 255, 0.3)',
  accentText: '#a9c0ff',
  accentTextStrong: '#d6e2ff',

  // Astra mark fills (hsl(198 …) from the desktop logo)
  logoMain: '#00b3ff', // hsl(198 100% 50%)
  logoShadow: '#152932', // hsl(198 40% 14%)
  logoBackdrop: '#05070a',
} as const;

export type ColorToken = keyof typeof colors;

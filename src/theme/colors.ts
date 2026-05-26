/**
 * Astra color tokens — ported from desktop `src/renderer/styles/globals.css`.
 * Dark-only on mobile (the desktop app is dark-only too).
 */
export const colors = {
  // Base backgrounds
  bgPrimary: '#000000',
  bgSecondary: '#050505',
  bgTertiary: '#0a0a0a',

  // Glass / surface overlays (white alphas)
  glassBg: 'rgba(255, 255, 255, 0.03)',
  glassBorder: 'rgba(255, 255, 255, 0.08)',
  glassHighlight: 'rgba(255, 255, 255, 0.05)',

  // Text (white alphas)
  textPrimary: 'rgba(255, 255, 255, 0.95)',
  textSecondary: 'rgba(255, 255, 255, 0.6)',
  textTertiary: 'rgba(255, 255, 255, 0.4)',

  // Cyan accent
  accent: '#38bdf8',
  accentHover: '#7dd3fc',
  accentGlow: 'rgba(56, 189, 248, 0.3)',
  accentText: '#bae6fd',
  accentTextStrong: '#e0f2fe',

  // Astra mark fills (hsl(198 …) from the desktop logo)
  logoMain: '#00b3ff', // hsl(198 100% 50%)
  logoShadow: '#152932', // hsl(198 40% 14%)
  logoBackdrop: '#05070a',
} as const;

export type ColorToken = keyof typeof colors;

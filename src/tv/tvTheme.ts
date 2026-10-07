import type { AppTheme } from '../theme/resolve.ts';
import { mixHex, rgbaFromHex } from '../theme/colorUtils.ts';

/** TV contrast and surfaces, derived from the same saved theme as the app. */
export function tvPalette(theme: AppTheme) {
  const c = theme.colors; const dark = theme.isDark; const midnight = theme.id === 'midnight';
  return {
    dark, bg: c.bgPrimary, text: c.textPrimary, muted: c.textSecondary, faint: c.textTertiary,
    strong: dark ? '#f6f8fd' : '#121b30', caption: midnight ? '#c9d1e1' : mixHex(c.textPrimary, c.textSecondary, .25),
    accent: c.accentText, accentStrong: c.accentTextStrong,
    focus: dark ? '#e8eeff' : '#263e70',
    fill: midnight ? 'rgba(124,146,196,.17)' : rgbaFromHex(c.textSecondary, .17),
    hover: rgbaFromHex(c.textSecondary, .09), border: c.glassBorder,
    surface: midnight ? '#111725' : c.bgTertiary,
    panel: midnight ? '#101522' : c.bgSecondary,
    scrim: dark ? 'rgba(4,6,10,.38)' : 'rgba(30,40,60,.16)',
    danger: dark ? '#ff9a9a' : '#a42136', onAccent: dark ? '#111725' : '#ffffff',
  };
}

import { useTheme } from '@/theme/themed';
import { EQ_BAND_COLOR_COUNT } from '@/audio/eq';
import type { EQBand } from '@/types/audio';

/**
 * Band colors for the parametric editor. Each band stores a *slot* (see
 * `EQBand.color`); these tables turn a slot into a color for the current
 * theme. Neighbouring slots differ in lightness as well as hue, so overlapping
 * bands stay distinguishable without relying on hue alone.
 *
 * Every entry must stay a 6-digit hex: the graph derives its fills with
 * `withAlpha`, which reads hex only (the palette-wide invariant).
 */
export const BAND_COLOR_NAMES = ['Coral', 'Amber', 'Mint', 'Blue', 'Violet', 'Pink', 'Cyan', 'Lime'] as const;

const DARK = ['#ff8f66', '#f5c542', '#3ecf9a', '#5c8aff', '#c38bff', '#ff6fae', '#5ad1e6', '#a3d65c'];
const LIGHT = ['#d4582a', '#a87a00', '#12936b', '#2f5fe0', '#8a4fd6', '#cc3a7e', '#1188a3', '#5a8a14'];

export interface BandPalette {
  colors: readonly string[];
  /** Text drawn on a filled band color (the node numbers, the panel badge). */
  ink: string;
}

const DARK_PALETTE: BandPalette = { colors: DARK, ink: '#0b0e1a' };
const LIGHT_PALETTE: BandPalette = { colors: LIGHT, ink: '#ffffff' };

if (DARK.length !== EQ_BAND_COLOR_COUNT || LIGHT.length !== EQ_BAND_COLOR_COUNT) {
  throw new Error('Band color tables must have EQ_BAND_COLOR_COUNT entries');
}

export function useBandPalette(): BandPalette {
  return useTheme().isDark ? DARK_PALETTE : LIGHT_PALETTE;
}

export function bandColor(palette: BandPalette, band: Pick<EQBand, 'color'>): string {
  if (typeof band.color === 'string') return band.color;
  return palette.colors[(band.color ?? 0) % palette.colors.length];
}

/**
 * Text on a filled band color. Palette slots use the theme's ink; a custom
 * color could be anything, so it picks dark or light ink by its luminance.
 */
export function bandInk(palette: BandPalette, band: Pick<EQBand, 'color'>): string {
  const hex = band.color;
  if (typeof hex !== 'string') return palette.ink;
  const channel = (i: number) => {
    const v = parseInt(hex.slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  const luminance = 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
  return luminance > 0.3 ? DARK_PALETTE.ink : LIGHT_PALETTE.ink;
}

/** Spoken name for a band's color. */
export function bandColorName(band: Pick<EQBand, 'color'>): string {
  if (typeof band.color === 'string') return `Custom ${band.color.toUpperCase()}`;
  return BAND_COLOR_NAMES[(band.color ?? 0) % BAND_COLOR_NAMES.length];
}

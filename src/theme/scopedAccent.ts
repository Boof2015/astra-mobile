import type { Palette } from './palettes.ts';
import { deriveAccentFromHex } from './accents.ts';

export function paletteWithAccent(
  colors: Palette,
  accentHex: string | null,
  isDark: boolean,
): Palette {
  return accentHex
    ? { ...colors, ...deriveAccentFromHex(accentHex, isDark) }
    : colors;
}

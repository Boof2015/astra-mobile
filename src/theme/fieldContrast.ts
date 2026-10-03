/**
 * Keeps now-playing readable over the living-gradient backdrop.
 *
 * The theme's quieter tokens (secondary/tertiary text, the glass border the
 * waveform's unplayed bars use) are tuned against the plain background. A
 * bright cover lifts the field enough to swallow them. The backdrop composites
 * its blobs as one layer at a fixed strength, so the brightest it can ever get
 * is computable from the field colors alone; this lifts just the tokens that
 * would fall below their contrast floor against that worst case, toward the
 * primary text color, and leaves everything else exactly as the theme has it.
 */
import { hexToRgb, mixHex } from './colorUtils.ts';
import type { Palette } from './palettes.ts';

/**
 * Layer opacity the backdrop composites its field at. Raise it and the text
 * lift follows automatically; 0.55 read as too muted on device (2026-10-02).
 */
export const FIELD_STRENGTH_DARK = 0.7;
export const FIELD_STRENGTH_LIGHT = 0.85;
/** Grey covers get a quieter field so it reads as atmosphere, not as fog. */
export const FIELD_NEUTRAL_SCALE = 0.6;

export function fieldStrength(isDark: boolean, neutral: boolean): number {
  return (isDark ? FIELD_STRENGTH_DARK : FIELD_STRENGTH_LIGHT) * (neutral ? FIELD_NEUTRAL_SCALE : 1);
}

/** WCAG floors: body-size text, and the de-emphasised tier (times, inactive icons). */
const SECONDARY_MIN_CONTRAST = 4.5;
const TERTIARY_MIN_CONTRAST = 3;
const MIX_STEP = 0.05;

function channelToLinear(channel: number): number {
  const c = channel / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

export function relativeLuminance(hex: string): number {
  const { r, g, b } = hexToRgb(hex);
  return 0.2126 * channelToLinear(r) + 0.7152 * channelToLinear(g) + 0.0722 * channelToLinear(b);
}

export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/**
 * The surface text can land on in the worst case: the field color furthest
 * from the background (brightest on dark themes, darkest on light), at full
 * layer strength over the background.
 */
export function worstFieldSurface(background: string, field: string[], strength: number, isDark: boolean): string {
  let worst = background;
  let worstLuminance = relativeLuminance(background);
  for (const color of field) {
    const surface = mixHex(background, color, strength);
    const luminance = relativeLuminance(surface);
    if (isDark ? luminance > worstLuminance : luminance < worstLuminance) {
      worst = surface;
      worstLuminance = luminance;
    }
  }
  return worst;
}

/** Mix `color` toward `toward` in small steps until it clears `min` against `surface`. */
export function liftToContrast(color: string, toward: string, surface: string, min: number): string {
  if (contrastRatio(color, surface) >= min) return color;
  for (let t = MIX_STEP; t < 1; t += MIX_STEP) {
    const candidate = mixHex(color, toward, t);
    if (contrastRatio(candidate, surface) >= min) return candidate;
  }
  return toward;
}

/**
 * The palette now-playing's own content uses over a given field. Null field
 * (no cover, or not resolved yet) returns the palette untouched.
 */
export function paletteOverField(
  palette: Palette,
  field: { colors: string[]; neutral: boolean } | null,
  isDark: boolean,
): Palette {
  if (!field || field.colors.length === 0) return palette;
  const surface = worstFieldSurface(
    palette.bgPrimary,
    field.colors,
    fieldStrength(isDark, field.neutral),
    isDark,
  );
  const ink = palette.textPrimary;
  return {
    ...palette,
    textSecondary: liftToContrast(palette.textSecondary, ink, surface, SECONDARY_MIN_CONTRAST),
    textTertiary: liftToContrast(palette.textTertiary, ink, surface, TERTIARY_MIN_CONTRAST),
    accentText: liftToContrast(palette.accentText, ink, surface, SECONDARY_MIN_CONTRAST),
    // The waveform's unplayed bars and hairlines: the strong rim exists for
    // exactly this, a surface that floats over arbitrary color.
    glassBorder: palette.glassBorderStrong,
  };
}

/**
 * Astra palettes. Every theme resolves to a `Palette` — same token names the
 * old dark-only `colors` object had, so consumers are theme-agnostic.
 *
 * INVARIANT: solid-color tokens must stay 6-digit `#rrggbb` hex — the Skia
 * visualizers (SpectrumCurve, OscilloscopeWave, EQGraph, GraphicResponseCurve)
 * slice hex chars to build alpha variants. Only `glass*`, `*Glow`,
 * `overlayFaint`, `ripple`, and `backdrop` may be `rgba()` strings (they are
 * never fed through those helpers).
 */

export interface Palette {
  // Base backgrounds
  bgPrimary: string;
  bgSecondary: string;
  bgTertiary: string;

  // Glass / surface overlays
  glassBg: string;
  glassBorder: string;
  glassHighlight: string;
  /** Native android_ripple tint (glassHighlight family, transient so slightly stronger). */
  ripple: string;

  // Text ramp
  textPrimary: string;
  textSecondary: string;
  textTertiary: string;

  warning: string;

  // Accent ramp (derived per accent choice, or from Material You)
  accent: string;
  accentHover: string;
  accentGlow: string;
  accentText: string;
  accentTextStrong: string;

  // Astra mark fills
  logoMain: string;
  logoShadow: string;
  logoBackdrop: string;

  /** Faint bg-tinted wash (mini-player artwork overlay, alphabet rail, home overlay). */
  overlayFaint: string;
  /** Modal/sheet scrim behind ActionSheet, prompts, target picker. */
  backdrop: string;
}

export type ColorToken = keyof Palette;

/** A base theme without the accent ramp — accents merge in at resolve time. */
export type BasePalette = Omit<
  Palette,
  'accent' | 'accentHover' | 'accentGlow' | 'accentText' | 'accentTextStrong'
>;

/**
 * Midnight — the original Astra dark. M3 redesign shifted the palette from
 * cyan-on-black toward a softer indigo-on-navy "mobile-first" language.
 */
export const midnightBase: BasePalette = {
  bgPrimary: '#080a0f',
  bgSecondary: '#0c0f18',
  bgTertiary: '#11162a',

  glassBg: 'rgba(124, 146, 196, 0.05)',
  glassBorder: 'rgba(124, 146, 196, 0.16)',
  glassHighlight: 'rgba(140, 162, 208, 0.08)',
  ripple: 'rgba(140, 162, 208, 0.13)',

  textPrimary: '#e2e8f4',
  textSecondary: '#8a98b8',
  textTertiary: '#52607f',

  warning: '#f3d27d',

  logoMain: '#00b3ff', // hsl(198 100% 50%)
  logoShadow: '#152932', // hsl(198 40% 14%)
  logoBackdrop: '#05070a',

  overlayFaint: 'rgba(8, 10, 15, 0.24)',
  backdrop: 'rgba(0, 0, 0, 0.55)',
};

/**
 * Dark — neutral gray dark, no navy cast. Matches the tone zone Material You
 * produces on a neutral wallpaper (which is where these values came from).
 */
export const darkBase: BasePalette = {
  bgPrimary: '#0f0f12',
  bgSecondary: '#141519',
  bgTertiary: '#1e2026',

  glassBg: 'rgba(165, 175, 195, 0.05)',
  glassBorder: 'rgba(165, 175, 195, 0.16)',
  glassHighlight: 'rgba(175, 185, 205, 0.08)',
  ripple: 'rgba(175, 185, 205, 0.13)',

  textPrimary: '#e6e8ec',
  textSecondary: '#979da8',
  textTertiary: '#5b616c',

  warning: '#f3d27d',

  logoMain: '#00b3ff',
  logoShadow: '#152932',
  logoBackdrop: '#0a0a0c',

  overlayFaint: 'rgba(15, 15, 18, 0.24)',
  backdrop: 'rgba(0, 0, 0, 0.55)',
};

/**
 * AMOLED — true black base, faint navy kept on raised surfaces so cards still
 * read as surfaces. Glass borders slightly stronger: they carry the structure
 * that background contrast provides on Midnight.
 */
export const amoledBase: BasePalette = {
  bgPrimary: '#000000',
  bgSecondary: '#05060a',
  bgTertiary: '#0b0e1a',

  glassBg: 'rgba(124, 146, 196, 0.06)',
  glassBorder: 'rgba(124, 146, 196, 0.20)',
  glassHighlight: 'rgba(140, 162, 208, 0.10)',
  ripple: 'rgba(140, 162, 208, 0.14)',

  textPrimary: '#e2e8f4',
  textSecondary: '#8a98b8',
  textTertiary: '#52607f',

  warning: '#f3d27d',

  logoMain: '#00b3ff',
  logoShadow: '#101f26',
  logoBackdrop: '#000000',

  overlayFaint: 'rgba(0, 0, 0, 0.30)',
  backdrop: 'rgba(0, 0, 0, 0.62)',
};

/**
 * Light — same navy hue family (H≈222) inverted: cool near-white surfaces,
 * navy-ink text ramp, glass flips to dark ink at low alpha. Starting values;
 * expect an on-device tuning pass (glass alphas, EQ fills, glow visibility).
 */
export const lightBase: BasePalette = {
  bgPrimary: '#f4f6fb',
  bgSecondary: '#eaeef7',
  bgTertiary: '#dde4f2',

  glassBg: 'rgba(52, 74, 130, 0.06)',
  glassBorder: 'rgba(52, 74, 130, 0.18)',
  glassHighlight: 'rgba(52, 74, 130, 0.10)',
  ripple: 'rgba(52, 74, 130, 0.12)',

  textPrimary: '#171d2e',
  textSecondary: '#4d5a78',
  textTertiary: '#8a94ad',

  warning: '#9a7b1f',

  logoMain: '#0087cc',
  logoShadow: '#c9dbe4',
  logoBackdrop: '#eef2f8',

  overlayFaint: 'rgba(244, 246, 251, 0.30)',
  backdrop: 'rgba(23, 29, 46, 0.40)',
};

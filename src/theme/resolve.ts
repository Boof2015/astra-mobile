import type { SystemPalette } from '../../modules/astra-system-colors';
import { deriveAccent, type AccentId } from './accents';
import { mixHex, rgbaFromHex } from './colorUtils';
import {
  amoledBase,
  darkBase,
  lightBase,
  midnightBase,
  type BasePalette,
  type Palette,
} from './palettes';

/** What the user picks in settings. */
export type BaseThemeId = 'system' | 'midnight' | 'dark' | 'amoled' | 'light' | 'materialYou';
/** Which dark theme "System" resolves to when the OS is dark. */
export type PreferredDark = 'midnight' | 'dark' | 'amoled';
/** What actually renders after resolution. */
export type ResolvedThemeId =
  | 'midnight'
  | 'dark'
  | 'amoled'
  | 'light'
  | 'materialYouDark'
  | 'materialYouLight';

export interface AppTheme {
  id: ResolvedThemeId;
  isDark: boolean;
  statusBarStyle: 'light' | 'dark';
  colors: Palette;
}

export function parseBaseTheme(value: string | null): BaseThemeId {
  switch (value) {
    case 'system':
    case 'midnight':
    case 'dark':
    case 'amoled':
    case 'light':
    case 'materialYou':
      return value;
    default:
      return 'midnight';
  }
}

export function parsePreferredDark(value: string | null): PreferredDark {
  return value === 'amoled' || value === 'dark' ? value : 'midnight';
}

const BASES: Record<
  'midnight' | 'dark' | 'amoled' | 'light',
  { base: BasePalette; isDark: boolean }
> = {
  midnight: { base: midnightBase, isDark: true },
  dark: { base: darkBase, isDark: true },
  amoled: { base: amoledBase, isDark: true },
  light: { base: lightBase, isDark: false },
};

/** Monet ramp index for tone t ∈ {0,10,50,100,200,...,900,1000}. */
function tone(ramp: string[], t: number): string {
  const index = t === 0 ? 0 : t === 10 ? 1 : t === 50 ? 2 : t / 100 + 2;
  return ramp[index];
}

/**
 * Maps monet ramps onto Astra tokens. Dark surfaces come from the accent2
 * ramp (monet's muted wallpaper-hue ramp, built exactly for tinted surfaces)
 * so the wallpaper color is actually visible — neutral1 is too low-chroma and
 * mixing it toward black erased the tint entirely. The neutral-gray look that
 * produced is now its own static "Dark" theme. Fractions are a starting
 * point; expect a device tuning pass. All solid outputs stay #rrggbb hex
 * (Skia invariant — see palettes.ts).
 */
export function buildMaterialYouPalette(ramps: SystemPalette, isDark: boolean): Palette {
  if (isDark) {
    const bgPrimary = mixHex(tone(ramps.accent2, 900), '#000000', 0.35);
    return {
      bgPrimary,
      bgSecondary: mixHex(tone(ramps.accent2, 900), '#000000', 0.12),
      bgTertiary: mixHex(tone(ramps.accent2, 800), '#000000', 0.25),
      glassBg: rgbaFromHex(tone(ramps.accent2, 200), 0.06),
      glassBorder: rgbaFromHex(tone(ramps.accent2, 200), 0.18),
      glassHighlight: rgbaFromHex(tone(ramps.accent2, 200), 0.09),
      textPrimary: tone(ramps.neutral1, 50),
      textSecondary: tone(ramps.neutral2, 300),
      textTertiary: tone(ramps.neutral2, 500),
      warning: '#f3d27d',
      accent: tone(ramps.accent1, 200),
      accentHover: tone(ramps.accent1, 100),
      accentGlow: rgbaFromHex(tone(ramps.accent1, 200), 0.3),
      accentText: tone(ramps.accent1, 100),
      accentTextStrong: tone(ramps.accent1, 50),
      logoMain: '#00b3ff',
      logoShadow: '#152932',
      logoBackdrop: '#05070a',
      overlayFaint: rgbaFromHex(bgPrimary, 0.24),
      backdrop: 'rgba(0, 0, 0, 0.55)',
    };
  }
  const bgPrimary = tone(ramps.neutral1, 10);
  return {
    bgPrimary,
    bgSecondary: tone(ramps.accent2, 50),
    bgTertiary: tone(ramps.accent2, 100),
    glassBg: rgbaFromHex(tone(ramps.neutral2, 700), 0.06),
    glassBorder: rgbaFromHex(tone(ramps.neutral2, 700), 0.16),
    glassHighlight: rgbaFromHex(tone(ramps.neutral2, 700), 0.09),
    textPrimary: tone(ramps.neutral1, 900),
    textSecondary: tone(ramps.neutral2, 700),
    textTertiary: tone(ramps.neutral2, 500),
    warning: '#9a7b1f',
    accent: tone(ramps.accent1, 600),
    accentHover: tone(ramps.accent1, 500),
    accentGlow: rgbaFromHex(tone(ramps.accent1, 600), 0.25),
    accentText: tone(ramps.accent1, 700),
    accentTextStrong: tone(ramps.accent1, 800),
    logoMain: '#0087cc',
    logoShadow: '#c9dbe4',
    logoBackdrop: '#eef2f8',
    overlayFaint: rgbaFromHex(bgPrimary, 0.24),
    backdrop: rgbaFromHex(tone(ramps.neutral1, 900), 0.45),
  };
}

export interface ResolveThemeInput {
  baseTheme: BaseThemeId;
  preferredDark: PreferredDark;
  accentId: AccentId;
  systemScheme: 'light' | 'dark';
  /** null → Material You unavailable (iOS, <API 31, module absent). */
  materialYouRamps: SystemPalette | null;
}

/** Pure resolution: settings + system inputs → one immutable AppTheme. */
export function resolveTheme(input: ResolveThemeInput): AppTheme {
  const { baseTheme, preferredDark, accentId, systemScheme, materialYouRamps } = input;

  if (baseTheme === 'materialYou' && materialYouRamps !== null) {
    const isDark = systemScheme === 'dark';
    return {
      id: isDark ? 'materialYouDark' : 'materialYouLight',
      isDark,
      statusBarStyle: isDark ? 'light' : 'dark',
      colors: buildMaterialYouPalette(materialYouRamps, isDark),
    };
  }

  // 'system' — and 'materialYou' with no ramps — follow the OS scheme.
  const staticId: 'midnight' | 'dark' | 'amoled' | 'light' =
    baseTheme === 'midnight' || baseTheme === 'dark' || baseTheme === 'amoled' || baseTheme === 'light'
      ? baseTheme
      : systemScheme === 'dark'
        ? preferredDark
        : 'light';

  const { base, isDark } = BASES[staticId];
  return {
    id: staticId,
    isDark,
    statusBarStyle: isDark ? 'light' : 'dark',
    colors: { ...base, ...deriveAccent(accentId, isDark) },
  };
}

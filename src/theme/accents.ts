import { hexToHsl, hslToHex, rgbaFromHex } from './colorUtils';

/**
 * Named accent choices. Each is a single base hex; the full 5-token ramp is
 * derived in `deriveAccent`. Base hexes are picked at similar perceived
 * brightness so the derived ramps land consistently. `overrides` is the
 * escape hatch if a hue derives badly (HSL lightness is perceptually off for
 * yellows — amber is the likely candidate).
 */
export interface AccentDef {
  label: string;
  base: string;
  overridesDark?: Partial<AccentTokens>;
  overridesLight?: Partial<AccentTokens>;
}

export const ACCENTS = {
  // The original default. Derivation lands within ±2/255 of the hand-tuned
  // ramp; overrides pin the legacy values exactly so Midnight is unchanged.
  indigo: {
    label: 'Indigo',
    base: '#5b8aff',
    overridesDark: {
      accentHover: '#82a6ff',
      accentText: '#a9c0ff',
      accentTextStrong: '#d6e2ff',
    },
  },
  cyan: { label: 'Astra Cyan', base: '#00b3ff' }, // logoMain
  violet: { label: 'Violet', base: '#9d7bff' },
  magenta: { label: 'Magenta', base: '#ff6b9d' },
  emerald: { label: 'Emerald', base: '#2dd4a0' },
  amber: { label: 'Amber', base: '#ffb454' },
  crimson: { label: 'Crimson', base: '#ff5c5c' },
} as const satisfies Record<string, AccentDef>;

export type AccentId = keyof typeof ACCENTS;
export const DEFAULT_ACCENT: AccentId = 'indigo';
export const ACCENT_IDS = Object.keys(ACCENTS) as AccentId[];

export function parseAccentId(value: string | null): AccentId {
  return value !== null && value in ACCENTS ? (value as AccentId) : DEFAULT_ACCENT;
}

export interface AccentTokens {
  accent: string;
  accentHover: string;
  accentGlow: string;
  accentText: string;
  accentTextStrong: string;
}

/**
 * Reproduces the hand-tuned indigo ramp (base hsl(223,100%,68%) → hover L+8,
 * text L=83, textStrong L=92, glow rgba(base, .30)). Light themes ramp DOWN
 * (text darker than base) because accentText sits on light surfaces.
 */
export function deriveAccent(id: AccentId, isDark: boolean): AccentTokens {
  const def: AccentDef = ACCENTS[id];
  const { h, s, l } = hexToHsl(def.base);
  const derived: AccentTokens = isDark
    ? {
        accent: def.base,
        accentHover: hslToHex(h, s, Math.min(l + 8, 96)),
        accentGlow: rgbaFromHex(def.base, 0.3),
        accentText: hslToHex(h, s, 83),
        accentTextStrong: hslToHex(h, s, 92),
      }
    : {
        accent: def.base,
        accentHover: hslToHex(h, s, Math.max(l - 8, 20)),
        accentGlow: rgbaFromHex(def.base, 0.25),
        accentText: hslToHex(h, s, 36),
        accentTextStrong: hslToHex(h, s, 26),
      };
  return { ...derived, ...(isDark ? def.overridesDark : def.overridesLight) };
}

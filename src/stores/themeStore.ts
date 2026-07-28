import { Appearance } from 'react-native';
import { create } from 'zustand';
import { AstraSystemColors, type SystemPalette } from '../../modules/astra-system-colors';
import { getNativeSetting, setNativeSetting } from '@/db/nativeSettings';
import {
  DEFAULT_ACCENT_PREFERENCE,
  parseAccentPreference,
  serializeAccentPreference,
  type AccentId,
  type AccentPreference,
} from '@/theme/accents';
import { normalizeHexColor } from '@/theme/colorUtils';
import {
  parseBaseTheme,
  parsePreferredDark,
  resolveTheme,
  type AppTheme,
  type BaseThemeId,
  type PreferredDark,
} from '@/theme/resolve';

/**
 * Theme preferences + the resolved palette. SQLite (settings table) is the
 * source of truth, mirrored in memory (same shape as settingsStore). Every
 * change recomputes `theme` exactly once — one new object identity per switch
 * is what invalidates the per-palette style caches in `createThemedStyles`.
 */
const BASE_THEME_KEY = 'theme_base';
const PREFERRED_DARK_KEY = 'theme_preferred_dark';
const ACCENT_KEY = 'theme_accent';
const NOW_PLAYING_ACCENT_SOURCE_KEY = 'now_playing_accent_source';
const COVER_ART_ACCENT_METHOD_KEY = 'now_playing_cover_art_method';

type SystemScheme = 'light' | 'dark';
export type NowPlayingAccentSource = 'app' | 'cover-art';
export type CoverArtAccentMethod = 'dominant' | 'vibrant' | 'average';

function currentSystemScheme(): SystemScheme {
  return Appearance.getColorScheme() === 'light' ? 'light' : 'dark';
}

// Monet ramps are an input to resolution, not reactive state — nothing renders
// them directly, they only matter through the recomputed `theme`.
let materialYouRamps: SystemPalette | null = null;

interface ResolutionInputs {
  baseTheme: BaseThemeId;
  preferredDark: PreferredDark;
  accentPreference: AccentPreference;
  systemScheme: SystemScheme;
}

function recompute(inputs: ResolutionInputs): AppTheme {
  return resolveTheme({ ...inputs, materialYouRamps });
}

interface ThemeStore extends ResolutionInputs {
  materialYouAvailable: boolean;
  accentPreviewHex: string | null;
  nowPlayingAccentSource: NowPlayingAccentSource;
  coverArtAccentMethod: CoverArtAccentMethod;
  theme: AppTheme;
  loaded: boolean;
  load: () => Promise<void>;
  setBaseTheme: (id: BaseThemeId) => Promise<void>;
  setPreferredDark: (id: PreferredDark) => Promise<void>;
  setAccent: (id: AccentId) => Promise<void>;
  setCustomAccent: (hex: string) => Promise<void>;
  previewCustomAccent: (hex: string | null) => void;
  setNowPlayingAccentSource: (source: NowPlayingAccentSource) => Promise<void>;
  setCoverArtAccentMethod: (method: CoverArtAccentMethod) => Promise<void>;
  /** Re-reads OS scheme + monet ramps; no-op set when nothing changed. */
  refreshSystemInputs: () => void;
}

const DEFAULT_INPUTS: ResolutionInputs = {
  baseTheme: 'midnight',
  preferredDark: 'midnight',
  accentPreference: DEFAULT_ACCENT_PREFERENCE,
  systemScheme: currentSystemScheme(),
};

function parseNowPlayingAccentSource(value: string | null): NowPlayingAccentSource {
  return value === 'cover-art' ? 'cover-art' : 'app';
}

function parseCoverArtAccentMethod(value: string | null): CoverArtAccentMethod {
  return value === 'average' || value === 'vibrant' ? value : 'dominant';
}

function effectiveInputs(state: ThemeStore): ResolutionInputs {
  return {
    baseTheme: state.baseTheme,
    preferredDark: state.preferredDark,
    accentPreference: state.accentPreviewHex
      ? { kind: 'custom', hex: state.accentPreviewHex }
      : state.accentPreference,
    systemScheme: state.systemScheme,
  };
}

export const useThemeStore = create<ThemeStore>((set, get) => ({
  ...DEFAULT_INPUTS,
  materialYouAvailable: AstraSystemColors.isAvailable(),
  accentPreviewHex: null,
  nowPlayingAccentSource: 'app',
  coverArtAccentMethod: 'dominant',
  theme: recompute(DEFAULT_INPUTS),
  loaded: false,

  load: async () => {
    if (get().loaded) return;
    const [base, dark, accent, nowPlayingAccentSource, coverArtAccentMethod] = await Promise.all([
      getNativeSetting(BASE_THEME_KEY),
      getNativeSetting(PREFERRED_DARK_KEY),
      getNativeSetting(ACCENT_KEY),
      getNativeSetting(NOW_PLAYING_ACCENT_SOURCE_KEY),
      getNativeSetting(COVER_ART_ACCENT_METHOD_KEY),
    ]);
    if (get().materialYouAvailable) {
      materialYouRamps = AstraSystemColors.getSystemPalette();
    }
    const inputs: ResolutionInputs = {
      baseTheme: parseBaseTheme(base),
      preferredDark: parsePreferredDark(dark),
      accentPreference: parseAccentPreference(accent),
      systemScheme: currentSystemScheme(),
    };
    set({
      ...inputs,
      nowPlayingAccentSource: parseNowPlayingAccentSource(nowPlayingAccentSource),
      coverArtAccentMethod: parseCoverArtAccentMethod(coverArtAccentMethod),
      theme: recompute(inputs),
      loaded: true,
    });
  },

  setBaseTheme: async (id) => {
    if (get().baseTheme === id) return;
    const inputs: ResolutionInputs = { ...effectiveInputs(get()), baseTheme: id };
    set({ baseTheme: id, theme: recompute(inputs) });
    await setNativeSetting(BASE_THEME_KEY, id);
  },

  setPreferredDark: async (id) => {
    if (get().preferredDark === id) return;
    const inputs: ResolutionInputs = { ...effectiveInputs(get()), preferredDark: id };
    set({ preferredDark: id, theme: recompute(inputs) });
    await setNativeSetting(PREFERRED_DARK_KEY, id);
  },

  setAccent: async (id) => {
    const preference: AccentPreference = { kind: 'preset', id };
    const current = get();
    if (
      current.accentPreviewHex === null &&
      current.accentPreference.kind === 'preset' &&
      current.accentPreference.id === id
    ) return;
    const inputs: ResolutionInputs = {
      ...effectiveInputs(get()),
      accentPreference: preference,
    };
    set({ accentPreference: preference, accentPreviewHex: null, theme: recompute(inputs) });
    await setNativeSetting(ACCENT_KEY, id);
  },

  setCustomAccent: async (hex) => {
    const normalized = normalizeHexColor(hex);
    if (!normalized) return;
    const preference: AccentPreference = { kind: 'custom', hex: normalized };
    const inputs: ResolutionInputs = {
      ...effectiveInputs(get()),
      accentPreference: preference,
    };
    set({ accentPreference: preference, accentPreviewHex: null, theme: recompute(inputs) });
    await setNativeSetting(ACCENT_KEY, serializeAccentPreference(preference));
  },

  previewCustomAccent: (hex) => {
    const normalized = hex === null ? null : normalizeHexColor(hex);
    if (get().accentPreviewHex === normalized) return;
    const inputs: ResolutionInputs = {
      ...effectiveInputs(get()),
      accentPreference: normalized
        ? { kind: 'custom', hex: normalized }
        : get().accentPreference,
    };
    set({ accentPreviewHex: normalized, theme: recompute(inputs) });
  },

  setNowPlayingAccentSource: async (source) => {
    if (get().nowPlayingAccentSource === source) return;
    set({ nowPlayingAccentSource: source });
    await setNativeSetting(NOW_PLAYING_ACCENT_SOURCE_KEY, source);
  },

  setCoverArtAccentMethod: async (method) => {
    if (get().coverArtAccentMethod === method) return;
    set({ coverArtAccentMethod: method });
    await setNativeSetting(COVER_ART_ACCENT_METHOD_KEY, method);
  },

  refreshSystemInputs: () => {
    const scheme = currentSystemScheme();
    const ramps = get().materialYouAvailable ? AstraSystemColors.getSystemPalette() : null;
    const rampsChanged = JSON.stringify(ramps) !== JSON.stringify(materialYouRamps);
    if (scheme === get().systemScheme && !rampsChanged) return;
    materialYouRamps = ramps;
    const inputs: ResolutionInputs = { ...effectiveInputs(get()), systemScheme: scheme };
    set({ systemScheme: scheme, theme: recompute(inputs) });
  },
}));

// OS dark/light toggles while the app runs. Wallpaper (monet) changes can't
// happen while Astra is foregrounded — those are covered by the AppState
// 'active' refresh wired in _layout.tsx.
Appearance.addChangeListener(() => useThemeStore.getState().refreshSystemInputs());

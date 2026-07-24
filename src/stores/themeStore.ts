import { Appearance } from 'react-native';
import { create } from 'zustand';
import { AstraSystemColors, type SystemPalette } from '../../modules/astra-system-colors';
import { getNativeSetting, setNativeSetting } from '@/db/nativeSettings';
import { parseAccentId, DEFAULT_ACCENT, type AccentId } from '@/theme/accents';
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

type SystemScheme = 'light' | 'dark';

function currentSystemScheme(): SystemScheme {
  return Appearance.getColorScheme() === 'light' ? 'light' : 'dark';
}

// Monet ramps are an input to resolution, not reactive state — nothing renders
// them directly, they only matter through the recomputed `theme`.
let materialYouRamps: SystemPalette | null = null;

interface ResolutionInputs {
  baseTheme: BaseThemeId;
  preferredDark: PreferredDark;
  accentId: AccentId;
  systemScheme: SystemScheme;
}

function recompute(inputs: ResolutionInputs): AppTheme {
  return resolveTheme({ ...inputs, materialYouRamps });
}

interface ThemeStore extends ResolutionInputs {
  materialYouAvailable: boolean;
  theme: AppTheme;
  loaded: boolean;
  load: () => Promise<void>;
  setBaseTheme: (id: BaseThemeId) => Promise<void>;
  setPreferredDark: (id: PreferredDark) => Promise<void>;
  setAccent: (id: AccentId) => Promise<void>;
  /** Re-reads OS scheme + monet ramps; no-op set when nothing changed. */
  refreshSystemInputs: () => void;
}

const DEFAULT_INPUTS: ResolutionInputs = {
  baseTheme: 'midnight',
  preferredDark: 'midnight',
  accentId: DEFAULT_ACCENT,
  systemScheme: currentSystemScheme(),
};

export const useThemeStore = create<ThemeStore>((set, get) => ({
  ...DEFAULT_INPUTS,
  materialYouAvailable: AstraSystemColors.isAvailable(),
  theme: recompute(DEFAULT_INPUTS),
  loaded: false,

  load: async () => {
    if (get().loaded) return;
    const [base, dark, accent] = await Promise.all([
      getNativeSetting(BASE_THEME_KEY),
      getNativeSetting(PREFERRED_DARK_KEY),
      getNativeSetting(ACCENT_KEY),
    ]);
    if (get().materialYouAvailable) {
      materialYouRamps = AstraSystemColors.getSystemPalette();
    }
    const inputs: ResolutionInputs = {
      baseTheme: parseBaseTheme(base),
      preferredDark: parsePreferredDark(dark),
      accentId: parseAccentId(accent),
      systemScheme: currentSystemScheme(),
    };
    set({ ...inputs, theme: recompute(inputs), loaded: true });
  },

  setBaseTheme: async (id) => {
    if (get().baseTheme === id) return;
    const inputs: ResolutionInputs = { ...get(), baseTheme: id };
    set({ baseTheme: id, theme: recompute(inputs) });
    await setNativeSetting(BASE_THEME_KEY, id);
  },

  setPreferredDark: async (id) => {
    if (get().preferredDark === id) return;
    const inputs: ResolutionInputs = { ...get(), preferredDark: id };
    set({ preferredDark: id, theme: recompute(inputs) });
    await setNativeSetting(PREFERRED_DARK_KEY, id);
  },

  setAccent: async (id) => {
    if (get().accentId === id) return;
    const inputs: ResolutionInputs = { ...get(), accentId: id };
    set({ accentId: id, theme: recompute(inputs) });
    await setNativeSetting(ACCENT_KEY, id);
  },

  refreshSystemInputs: () => {
    const scheme = currentSystemScheme();
    const ramps = get().materialYouAvailable ? AstraSystemColors.getSystemPalette() : null;
    const rampsChanged = JSON.stringify(ramps) !== JSON.stringify(materialYouRamps);
    if (scheme === get().systemScheme && !rampsChanged) return;
    materialYouRamps = ramps;
    const inputs: ResolutionInputs = { ...get(), systemScheme: scheme };
    set({ systemScheme: scheme, theme: recompute(inputs) });
  },
}));

// OS dark/light toggles while the app runs. Wallpaper (monet) changes can't
// happen while Astra is foregrounded — those are covered by the AppState
// 'active' refresh wired in _layout.tsx.
Appearance.addChangeListener(() => useThemeStore.getState().refreshSystemInputs());

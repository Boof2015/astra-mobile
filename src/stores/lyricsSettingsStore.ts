import { create } from 'zustand';
import { getNativeSetting, setNativeSetting } from '@/db/nativeSettings';
import {
  DEFAULT_LYRICS_DISPLAY_SETTINGS,
  normalizeLyricsDisplaySettings,
  normalizeLyricsLanguagePriority,
  type LyricsDisplaySettings,
} from '@/lyrics/displaySettings';

export {
  DEFAULT_LYRICS_DISPLAY_SETTINGS,
  DEFAULT_LYRICS_LANGUAGE_PRIORITY,
  normalizeLyricsDisplaySettings,
  normalizeLyricsLanguagePriority,
  type LyricsDisplaySettings,
} from '@/lyrics/displaySettings';

const ONLINE_LOOKUP_KEY = 'lyrics_online_lookup_enabled';
const DISPLAY_SETTINGS_KEY = 'lyrics_display_settings_v1';

interface LyricsSettingsStore extends LyricsDisplaySettings {
  onlineLookupEnabled: boolean;
  loaded: boolean;
  load: () => Promise<void>;
  setOnlineLookupEnabled: (enabled: boolean) => Promise<void>;
  setWordTimingEnabled: (enabled: boolean) => Promise<void>;
  setFuriganaEnabled: (enabled: boolean) => Promise<void>;
  setTranslationsEnabled: (enabled: boolean) => Promise<void>;
  setTranslationPriority: (value: string | string[]) => Promise<void>;
  setVoiceLabelsEnabled: (enabled: boolean) => Promise<void>;
}

function displaySettingsFromState(state: LyricsSettingsStore): LyricsDisplaySettings {
  return {
    wordTimingEnabled: state.wordTimingEnabled,
    furiganaEnabled: state.furiganaEnabled,
    translationsEnabled: state.translationsEnabled,
    translationPriority: state.translationPriority,
    voiceLabelsEnabled: state.voiceLabelsEnabled,
  };
}

async function persistDisplaySettings(settings: LyricsDisplaySettings): Promise<void> {
  await setNativeSetting(DISPLAY_SETTINGS_KEY, JSON.stringify(settings));
}

let loadPromise: Promise<void> | null = null;

export const useLyricsSettingsStore = create<LyricsSettingsStore>((set, get) => ({
  onlineLookupEnabled: true,
  ...DEFAULT_LYRICS_DISPLAY_SETTINGS,
  loaded: false,

  load: async () => {
    if (get().loaded) return;
    if (loadPromise) return loadPromise;
    loadPromise = (async () => {
      const [onlineValue, displayValue] = await Promise.all([
        getNativeSetting(ONLINE_LOOKUP_KEY),
        getNativeSetting(DISPLAY_SETTINGS_KEY),
      ]);
      let parsed: unknown = null;
      try {
        parsed = displayValue ? JSON.parse(displayValue) : null;
      } catch {
        parsed = null;
      }
      set({
        onlineLookupEnabled: onlineValue === null ? true : onlineValue === 'true',
        ...normalizeLyricsDisplaySettings(parsed),
        loaded: true,
      });
    })().finally(() => {
      loadPromise = null;
    });
    return loadPromise;
  },

  setOnlineLookupEnabled: async (enabled) => {
    await get().load();
    set({ onlineLookupEnabled: enabled });
    await setNativeSetting(ONLINE_LOOKUP_KEY, enabled ? 'true' : 'false');
  },

  setWordTimingEnabled: async (enabled) => {
    await get().load();
    set({ wordTimingEnabled: enabled });
    await persistDisplaySettings({ ...displaySettingsFromState(get()), wordTimingEnabled: enabled });
  },

  setFuriganaEnabled: async (enabled) => {
    await get().load();
    set({ furiganaEnabled: enabled });
    await persistDisplaySettings({ ...displaySettingsFromState(get()), furiganaEnabled: enabled });
  },

  setTranslationsEnabled: async (enabled) => {
    await get().load();
    set({ translationsEnabled: enabled });
    await persistDisplaySettings({ ...displaySettingsFromState(get()), translationsEnabled: enabled });
  },

  setTranslationPriority: async (value) => {
    await get().load();
    const translationPriority = normalizeLyricsLanguagePriority(value);
    set({ translationPriority });
    await persistDisplaySettings({ ...displaySettingsFromState(get()), translationPriority });
  },

  setVoiceLabelsEnabled: async (enabled) => {
    await get().load();
    set({ voiceLabelsEnabled: enabled });
    await persistDisplaySettings({ ...displaySettingsFromState(get()), voiceLabelsEnabled: enabled });
  },
}));

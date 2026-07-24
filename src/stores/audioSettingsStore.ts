import { create } from 'zustand';
import { getNativeSetting, setNativeSetting } from '@/db/nativeSettings';
import {
  DEFAULT_TARGET_LUFS,
  type NormalizationSettings,
  type ReplayGainMode,
} from '@/audio/normalization';

/**
 * Loudness/normalization + ReplayGain preferences. SQLite (settings table) is the
 * source of truth, mirrored in memory (settingsStore pattern; no zustand-persist).
 * The EQ's own state lives in eqStore — this store is the normalization half.
 */
const NORMALIZATION_ENABLED_KEY = 'normalization_enabled';
const NORMALIZATION_TARGET_KEY = 'normalization_target_lufs';
const REPLAYGAIN_ENABLED_KEY = 'replaygain_enabled';
const REPLAYGAIN_MODE_KEY = 'replaygain_mode';

function parseMode(value: string | null): ReplayGainMode {
  return value === 'track' || value === 'album' ? value : 'auto';
}

interface AudioSettingsStore {
  normalizationEnabled: boolean;
  normalizationTargetLufs: number;
  replayGainEnabled: boolean;
  replayGainMode: ReplayGainMode;
  loaded: boolean;

  load: () => Promise<void>;
  setNormalizationEnabled: (enabled: boolean) => Promise<void>;
  setNormalizationTargetLufs: (lufs: number) => Promise<void>;
  setReplayGainEnabled: (enabled: boolean) => Promise<void>;
  setReplayGainMode: (mode: ReplayGainMode) => Promise<void>;
  /** Current settings as the plain shape the gain resolver consumes. */
  asNormalizationSettings: () => NormalizationSettings;
}

export const useAudioSettingsStore = create<AudioSettingsStore>((set, get) => ({
  normalizationEnabled: true,
  normalizationTargetLufs: DEFAULT_TARGET_LUFS,
  replayGainEnabled: false,
  replayGainMode: 'auto',
  loaded: false,

  load: async () => {
    if (get().loaded) return;
    const [enabled, target, rgEnabled, rgMode] = await Promise.all([
      getNativeSetting(NORMALIZATION_ENABLED_KEY),
      getNativeSetting(NORMALIZATION_TARGET_KEY),
      getNativeSetting(REPLAYGAIN_ENABLED_KEY),
      getNativeSetting(REPLAYGAIN_MODE_KEY),
    ]);
    const targetNum = Number(target);
    set({
      // Defaults to ON when never set.
      normalizationEnabled: enabled === null ? true : enabled === 'true',
      normalizationTargetLufs: Number.isFinite(targetNum) && target !== null ? targetNum : DEFAULT_TARGET_LUFS,
      replayGainEnabled: rgEnabled === 'true',
      replayGainMode: parseMode(rgMode),
      loaded: true,
    });
  },

  setNormalizationEnabled: async (enabled) => {
    if (get().normalizationEnabled === enabled) return;
    set({ normalizationEnabled: enabled });
    await setNativeSetting(NORMALIZATION_ENABLED_KEY, enabled ? 'true' : 'false');
  },

  setNormalizationTargetLufs: async (lufs) => {
    const clamped = Math.max(-30, Math.min(-5, lufs));
    if (get().normalizationTargetLufs === clamped) return;
    set({ normalizationTargetLufs: clamped });
    await setNativeSetting(NORMALIZATION_TARGET_KEY, String(clamped));
  },

  setReplayGainEnabled: async (enabled) => {
    if (get().replayGainEnabled === enabled) return;
    set({ replayGainEnabled: enabled });
    await setNativeSetting(REPLAYGAIN_ENABLED_KEY, enabled ? 'true' : 'false');
  },

  setReplayGainMode: async (mode) => {
    if (get().replayGainMode === mode) return;
    set({ replayGainMode: mode });
    await setNativeSetting(REPLAYGAIN_MODE_KEY, mode);
  },

  asNormalizationSettings: () => {
    const s = get();
    return {
      enabled: s.normalizationEnabled,
      targetLufs: s.normalizationTargetLufs,
      replayGainEnabled: s.replayGainEnabled,
      replayGainMode: s.replayGainMode,
    };
  },
}));

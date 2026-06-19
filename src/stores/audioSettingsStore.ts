import { create } from 'zustand';
import { openLibraryDb } from '@/db/database';
import { getSetting, setSetting } from '@/db/queries';
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
    const db = await openLibraryDb();
    const [enabled, target, rgEnabled, rgMode] = await Promise.all([
      getSetting(db, NORMALIZATION_ENABLED_KEY),
      getSetting(db, NORMALIZATION_TARGET_KEY),
      getSetting(db, REPLAYGAIN_ENABLED_KEY),
      getSetting(db, REPLAYGAIN_MODE_KEY),
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
    const db = await openLibraryDb();
    await setSetting(db, NORMALIZATION_ENABLED_KEY, enabled ? 'true' : 'false');
  },

  setNormalizationTargetLufs: async (lufs) => {
    const clamped = Math.max(-30, Math.min(-5, lufs));
    if (get().normalizationTargetLufs === clamped) return;
    set({ normalizationTargetLufs: clamped });
    const db = await openLibraryDb();
    await setSetting(db, NORMALIZATION_TARGET_KEY, String(clamped));
  },

  setReplayGainEnabled: async (enabled) => {
    if (get().replayGainEnabled === enabled) return;
    set({ replayGainEnabled: enabled });
    const db = await openLibraryDb();
    await setSetting(db, REPLAYGAIN_ENABLED_KEY, enabled ? 'true' : 'false');
  },

  setReplayGainMode: async (mode) => {
    if (get().replayGainMode === mode) return;
    set({ replayGainMode: mode });
    const db = await openLibraryDb();
    await setSetting(db, REPLAYGAIN_MODE_KEY, mode);
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

import { create } from 'zustand';
import type { EQBand, EQPreset } from '@/types/audio';
import { openLibraryDb } from '@/db/database';
import { getSetting, setSetting } from '@/db/queries';
import {
  EQ_MAX_BANDS,
  clampEQFrequency,
  clampEQGain,
  clampEQQ,
  clampPreamp,
  createNormalizedEQBand,
  dbToLinear,
  flattenBandsForNative,
} from '@/audio/eq';
import { createBuiltInPresets, createDefaultBands, FLAT_PRESET_ID, genEqId } from '@/audio/eqPresets';
import { setEqBandsNative, setEqEnabledNative, setEqPreampNative } from '@/audio/eqNative';

/**
 * Parametric EQ state — SQLite (settings table) is the source of truth, mirrored
 * in memory (mirrors the settingsStore pattern; no zustand-persist). Every band/
 * preamp/enable change pushes params to the native EqAudioProcessor via _syncToNative
 * (immediate, for live audio) and debounce-persists to SQLite.
 */
const ENABLED_KEY = 'eq_enabled';
const PREAMP_KEY = 'eq_preamp';
const BANDS_KEY = 'eq_bands';
const ACTIVE_PRESET_KEY = 'eq_active_preset';
const CUSTOM_PRESETS_KEY = 'eq_custom_presets';

const PERSIST_DEBOUNCE_MS = 250;

function parseBands(json: string | null): EQBand[] | null {
  if (!json) return null;
  try {
    const arr = JSON.parse(json);
    if (!Array.isArray(arr) || arr.length === 0) return null;
    return arr.slice(0, EQ_MAX_BANDS).map((raw) => createNormalizedEQBand(raw, genEqId()));
  } catch {
    return null;
  }
}

function parseCustomPresets(json: string | null): EQPreset[] {
  if (!json) return [];
  try {
    const arr = JSON.parse(json);
    if (!Array.isArray(arr)) return [];
    return arr
      .filter((p): p is { id?: string; name: string; preamp?: number; bands?: unknown[] } => !!p && typeof p.name === 'string')
      .map((p) => ({
        // Keep the stored id so a persisted activePresetId still matches on reload.
        id: typeof p.id === 'string' && p.id.length > 0 ? p.id : genEqId(),
        name: p.name,
        preamp: clampPreamp(typeof p.preamp === 'number' ? p.preamp : 0),
        bands: Array.isArray(p.bands)
          ? p.bands.slice(0, EQ_MAX_BANDS).map((b) => createNormalizedEQBand(b as object, genEqId()))
          : createDefaultBands(),
        isCustom: true,
      }));
  } catch {
    return [];
  }
}

interface EQStore {
  enabled: boolean;
  preamp: number; // dB
  bands: EQBand[];
  presets: EQPreset[]; // built-in + custom
  activePresetId: string | null; // null = manually edited ("Custom")
  activeBandId: string | null; // UI selection shared by curve / strip / panel
  loaded: boolean;

  load: () => Promise<void>;
  setEnabled: (enabled: boolean) => void;
  toggleEnabled: () => void;
  setPreamp: (db: number) => void;
  addBand: (band?: Partial<EQBand>) => void;
  removeBand: (id: string) => void;
  updateBand: (id: string, updates: Partial<EQBand>) => void;
  selectBand: (id: string | null) => void;
  applyPreset: (presetId: string) => void;
  resetToFlat: () => void;
  saveCustomPreset: (name: string) => void;
  deleteCustomPreset: (presetId: string) => void;
  importPreset: (preset: EQPreset) => void;

  _syncToNative: () => void;
}

let persistTimer: ReturnType<typeof setTimeout> | null = null;

export const useEQStore = create<EQStore>((set, get) => {
  function syncToNative(): void {
    const { enabled, preamp, bands } = get();
    setEqEnabledNative(enabled);
    setEqPreampNative(enabled ? dbToLinear(preamp) : 1);
    setEqBandsNative(flattenBandsForNative(bands));
  }

  function schedulePersist(): void {
    if (persistTimer) clearTimeout(persistTimer);
    persistTimer = setTimeout(() => {
      persistTimer = null;
      void persistNow();
    }, PERSIST_DEBOUNCE_MS);
  }

  async function persistNow(): Promise<void> {
    const { enabled, preamp, bands, activePresetId, presets } = get();
    const custom = presets.filter((p) => p.isCustom);
    try {
      const db = await openLibraryDb();
      await Promise.all([
        setSetting(db, ENABLED_KEY, enabled ? 'true' : 'false'),
        setSetting(db, PREAMP_KEY, String(preamp)),
        setSetting(db, BANDS_KEY, JSON.stringify(bands)),
        setSetting(db, ACTIVE_PRESET_KEY, activePresetId ?? ''),
        setSetting(
          db,
          CUSTOM_PRESETS_KEY,
          JSON.stringify(
            custom.map((p) => ({ id: p.id, name: p.name, preamp: p.preamp, bands: p.bands }))
          )
        ),
      ]);
    } catch {
      /* persistence failure is non-fatal */
    }
  }

  /** Mark the current band set as a manual edit (no longer matches a preset). */
  function markEdited(patch: Partial<EQStore>): void {
    set({ ...patch, activePresetId: null });
    syncToNative();
    schedulePersist();
  }

  return {
    enabled: false,
    preamp: 0,
    bands: createDefaultBands(),
    presets: createBuiltInPresets(),
    activePresetId: FLAT_PRESET_ID,
    activeBandId: null,
    loaded: false,

    load: async () => {
      if (get().loaded) return;
      const db = await openLibraryDb();
      const [enabledRaw, preampRaw, bandsRaw, activeRaw, customRaw] = await Promise.all([
        getSetting(db, ENABLED_KEY),
        getSetting(db, PREAMP_KEY),
        getSetting(db, BANDS_KEY),
        getSetting(db, ACTIVE_PRESET_KEY),
        getSetting(db, CUSTOM_PRESETS_KEY),
      ]);

      const bands = parseBands(bandsRaw) ?? createDefaultBands();
      const presets = [...createBuiltInPresets(), ...parseCustomPresets(customRaw)];
      const storedActive = activeRaw && activeRaw.length > 0 ? activeRaw : null;

      set({
        enabled: enabledRaw === 'true',
        preamp: clampPreamp(Number(preampRaw) || 0),
        bands,
        presets,
        // Stored active preset ids are regenerated on load (parseCustomPresets makes
        // new ids), so only built-in ids survive a reload; fall back to "Custom".
        activePresetId: presets.some((p) => p.id === storedActive) ? storedActive : null,
        activeBandId: bands[0]?.id ?? null,
        loaded: true,
      });
      syncToNative();
    },

    setEnabled: (enabled) => {
      set({ enabled });
      syncToNative();
      schedulePersist();
    },

    toggleEnabled: () => {
      set({ enabled: !get().enabled });
      syncToNative();
      schedulePersist();
    },

    setPreamp: (db) => markEdited({ preamp: clampPreamp(db) }),

    addBand: (partial) => {
      const { bands } = get();
      if (bands.length >= EQ_MAX_BANDS) return;
      const band = createNormalizedEQBand(
        {
          type: partial?.type ?? 'peaking',
          frequency: partial?.frequency ?? 1000,
          gain: partial?.gain ?? 0,
          Q: partial?.Q ?? 1.0,
          enabled: partial?.enabled ?? true,
        },
        genEqId()
      );
      const next = [...bands, band].sort((a, b) => a.frequency - b.frequency);
      markEdited({ bands: next, activeBandId: band.id });
    },

    removeBand: (id) => {
      const { bands, activeBandId } = get();
      if (bands.length <= 1) return;
      const next = bands.filter((b) => b.id !== id);
      markEdited({
        bands: next,
        activeBandId: activeBandId === id ? (next[0]?.id ?? null) : activeBandId,
      });
    },

    updateBand: (id, updates) => {
      const next = get().bands.map((b) => {
        if (b.id !== id) return b;
        const merged: EQBand = { ...b, ...updates };
        if (updates.frequency !== undefined) merged.frequency = clampEQFrequency(updates.frequency);
        if (updates.gain !== undefined) merged.gain = clampEQGain(updates.gain);
        if (updates.Q !== undefined) merged.Q = clampEQQ(updates.Q);
        return merged;
      });
      markEdited({
        bands: updates.frequency !== undefined ? next.sort((a, b) => a.frequency - b.frequency) : next,
      });
    },

    selectBand: (id) => set({ activeBandId: id }),

    applyPreset: (presetId) => {
      const preset = get().presets.find((p) => p.id === presetId);
      if (!preset) return;
      const bands = preset.bands.map((b) => createNormalizedEQBand(b, genEqId()));
      set({
        bands,
        preamp: clampPreamp(preset.preamp),
        activePresetId: presetId,
        activeBandId: bands[0]?.id ?? null,
      });
      syncToNative();
      schedulePersist();
    },

    resetToFlat: () => get().applyPreset(FLAT_PRESET_ID),

    saveCustomPreset: (name) => {
      const { bands, preamp, presets } = get();
      const preset: EQPreset = {
        id: genEqId(),
        name: name.trim() || 'Custom Preset',
        preamp,
        bands: bands.map((b) => ({ ...b, id: genEqId() })),
        isCustom: true,
      };
      set({ presets: [...presets, preset], activePresetId: preset.id });
      schedulePersist();
    },

    deleteCustomPreset: (presetId) => {
      const { presets, activePresetId } = get();
      set({
        presets: presets.filter((p) => p.id !== presetId),
        activePresetId: activePresetId === presetId ? null : activePresetId,
      });
      schedulePersist();
    },

    importPreset: (preset) => {
      const stored: EQPreset = { ...preset, id: genEqId(), isCustom: true };
      set({ presets: [...get().presets, stored] });
      get().applyPreset(stored.id);
    },

    _syncToNative: syncToNative,
  };
});

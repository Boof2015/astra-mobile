import { create } from 'zustand';
import type { AudioOutputRoute, EQBand, EQMode, EQPreset } from '@/types/audio';
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
import {
  buildGraphicBands,
  createFlatGraphicGains,
  deriveGraphicGains,
  parseGraphicGains,
} from '@/audio/graphicEq';
import {
  createEQRouteProfile,
  normalizeAudioOutputRoute,
  parseEQRouteProfilesJson,
  restoreEQRouteProfile,
  stringifyEQRouteProfiles,
  type EQRouteProfile,
} from '@/audio/eqRouteProfiles';
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
const MODE_KEY = 'eq_mode';
const GRAPHIC_GAINS_KEY = 'eq_graphic_gains';
const ROUTE_PROFILES_KEY = 'eq_route_profiles_v1';

const PERSIST_DEBOUNCE_MS = 250;

function safeJsonParse(json: string | null): unknown {
  if (!json) return null;
  try {
    return JSON.parse(json);
  } catch {
    return null;
  }
}

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
      .filter(
        (p): p is { id?: string; name: string; preamp?: number; bands?: unknown[]; mode?: unknown; graphicGains?: unknown } =>
          !!p && typeof p.name === 'string'
      )
      .map((p) => {
        // Invalid/missing graphic gains degrade the preset to parametric — the
        // compiled bands snapshot below sounds identical.
        const graphicGains = p.mode === 'graphic' ? parseGraphicGains(p.graphicGains) : null;
        return {
          // Keep the stored id so a persisted activePresetId still matches on reload.
          id: typeof p.id === 'string' && p.id.length > 0 ? p.id : genEqId(),
          name: p.name,
          preamp: clampPreamp(typeof p.preamp === 'number' ? p.preamp : 0),
          bands: Array.isArray(p.bands)
            ? p.bands.slice(0, EQ_MAX_BANDS).map((b) => createNormalizedEQBand(b as object, genEqId()))
            : createDefaultBands(),
          isCustom: true,
          ...(graphicGains ? { mode: 'graphic' as const, graphicGains } : {}),
        };
      });
  } catch {
    return [];
  }
}

interface EQStore {
  enabled: boolean;
  preamp: number; // dB
  bands: EQBand[];
  mode: EQMode; // which editor drives the native bands (preamp/enabled are shared)
  graphicGains: number[]; // graphic-mode slider gains (dB), independent of `bands`
  presets: EQPreset[]; // built-in + custom
  activePresetId: string | null; // null = manually edited ("Custom")
  activeBandId: string | null; // UI selection shared by curve / strip / panel
  activeOutputRoute: AudioOutputRoute | null;
  loaded: boolean;

  load: () => Promise<void>;
  setEnabled: (enabled: boolean) => void;
  toggleEnabled: () => void;
  setPreamp: (db: number) => void;
  setMode: (mode: EQMode) => void;
  setGraphicGain: (index: number, gainDb: number) => void;
  addBand: (band?: Partial<EQBand>) => void;
  removeBand: (id: string) => void;
  updateBand: (id: string, updates: Partial<EQBand>) => void;
  selectBand: (id: string | null) => void;
  applyPreset: (presetId: string) => void;
  resetToFlat: () => void;
  saveCustomPreset: (name: string) => void;
  deleteCustomPreset: (presetId: string) => void;
  importPreset: (preset: EQPreset) => void;
  setOutputRoute: (route: AudioOutputRoute | null) => Promise<void>;

  _syncToNative: () => void;
}

let persistTimer: ReturnType<typeof setTimeout> | null = null;
let routeProfilesByKey: Record<string, EQRouteProfile> = {};

export const useEQStore = create<EQStore>((set, get) => {
  function syncToNative(): void {
    const { enabled, preamp, bands, mode, graphicGains } = get();
    const activeBands = mode === 'graphic' ? buildGraphicBands(graphicGains) : bands;
    setEqEnabledNative(enabled);
    setEqPreampNative(enabled ? dbToLinear(preamp) : 1);
    setEqBandsNative(flattenBandsForNative(activeBands));
  }

  function captureRouteProfile(route: AudioOutputRoute | null = get().activeOutputRoute): void {
    if (!route) return;
    const { enabled, preamp, mode, bands, graphicGains, activePresetId } = get();
    routeProfilesByKey = {
      ...routeProfilesByKey,
      [route.key]: createEQRouteProfile(route, {
        enabled,
        preamp,
        mode,
        bands,
        graphicGains,
        activePresetId,
      }),
    };
  }

  function schedulePersist(): void {
    captureRouteProfile();
    if (persistTimer) clearTimeout(persistTimer);
    persistTimer = setTimeout(() => {
      persistTimer = null;
      void persistNow();
    }, PERSIST_DEBOUNCE_MS);
  }

  async function persistNow(): Promise<void> {
    captureRouteProfile();
    const { enabled, preamp, bands, mode, graphicGains, activePresetId, presets } = get();
    const custom = presets.filter((p) => p.isCustom);
    try {
      const db = await openLibraryDb();
      await Promise.all([
        setSetting(db, ENABLED_KEY, enabled ? 'true' : 'false'),
        setSetting(db, PREAMP_KEY, String(preamp)),
        setSetting(db, BANDS_KEY, JSON.stringify(bands)),
        setSetting(db, MODE_KEY, mode),
        setSetting(db, GRAPHIC_GAINS_KEY, JSON.stringify(graphicGains)),
        setSetting(db, ACTIVE_PRESET_KEY, activePresetId ?? ''),
        setSetting(db, ROUTE_PROFILES_KEY, stringifyEQRouteProfiles(routeProfilesByKey)),
        setSetting(
          db,
          CUSTOM_PRESETS_KEY,
          JSON.stringify(
            custom.map((p) => ({
              id: p.id,
              name: p.name,
              preamp: p.preamp,
              bands: p.bands,
              ...(p.mode === 'graphic' ? { mode: p.mode, graphicGains: p.graphicGains } : {}),
            }))
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
    mode: 'parametric',
    graphicGains: createFlatGraphicGains(),
    presets: createBuiltInPresets(),
    activePresetId: FLAT_PRESET_ID,
    activeBandId: null,
    activeOutputRoute: null,
    loaded: false,

    load: async () => {
      if (get().loaded) return;
      const db = await openLibraryDb();
      const [enabledRaw, preampRaw, bandsRaw, modeRaw, gainsRaw, activeRaw, customRaw, routeProfilesRaw] = await Promise.all([
        getSetting(db, ENABLED_KEY),
        getSetting(db, PREAMP_KEY),
        getSetting(db, BANDS_KEY),
        getSetting(db, MODE_KEY),
        getSetting(db, GRAPHIC_GAINS_KEY),
        getSetting(db, ACTIVE_PRESET_KEY),
        getSetting(db, CUSTOM_PRESETS_KEY),
        getSetting(db, ROUTE_PROFILES_KEY),
      ]);

      const bands = parseBands(bandsRaw) ?? createDefaultBands();
      const presets = [...createBuiltInPresets(), ...parseCustomPresets(customRaw)];
      const storedActive = activeRaw && activeRaw.length > 0 ? activeRaw : null;
      routeProfilesByKey = parseEQRouteProfilesJson(routeProfilesRaw, genEqId);

      set({
        enabled: enabledRaw === 'true',
        preamp: clampPreamp(Number(preampRaw) || 0),
        bands,
        // Missing key (pre-graphic installs) → parametric.
        mode: modeRaw === 'graphic' ? 'graphic' : 'parametric',
        graphicGains: parseGraphicGains(safeJsonParse(gainsRaw)) ?? createFlatGraphicGains(),
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

    setMode: (mode) => {
      if (get().mode === mode) return;
      // Non-destructive: both modes keep their own band state; only the preset
      // label stops describing what's audible.
      set({ mode, activePresetId: null });
      syncToNative();
      schedulePersist();
    },

    setGraphicGain: (index, gainDb) => {
      const gains = get().graphicGains;
      if (index < 0 || index >= gains.length) return;
      const next = gains.slice();
      next[index] = clampEQGain(gainDb);
      markEdited({ graphicGains: next });
    },

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
      // Custom presets re-open in the mode they were saved in (each branch leaves
      // the other mode's band state untouched); built-ins are mode-agnostic and
      // apply in whichever mode is active.
      const graphicGains = preset.mode === 'graphic' ? parseGraphicGains(preset.graphicGains) : null;
      if (graphicGains) {
        set({
          mode: 'graphic',
          graphicGains,
          preamp: clampPreamp(preset.preamp),
          activePresetId: presetId,
        });
      } else if (!preset.isCustom && get().mode === 'graphic') {
        // Project the parametric built-in onto the 5 sliders (its response
        // sampled at each band frequency) instead of yanking the user out of
        // graphic mode.
        set({
          graphicGains: deriveGraphicGains(preset.bands),
          preamp: clampPreamp(preset.preamp),
          activePresetId: presetId,
        });
      } else {
        const bands = preset.bands.map((b) => createNormalizedEQBand(b, genEqId()));
        set({
          mode: 'parametric',
          bands,
          preamp: clampPreamp(preset.preamp),
          activePresetId: presetId,
          activeBandId: bands[0]?.id ?? null,
        });
      }
      syncToNative();
      schedulePersist();
    },

    resetToFlat: () => {
      // In graphic mode, flatten in place — applying the parametric Flat preset
      // would silently switch modes.
      if (get().mode === 'graphic') {
        set({ graphicGains: createFlatGraphicGains(), preamp: 0, activePresetId: null });
        syncToNative();
        schedulePersist();
        return;
      }
      get().applyPreset(FLAT_PRESET_ID);
    },

    saveCustomPreset: (name) => {
      const { bands, mode, graphicGains, preamp, presets } = get();
      const preset: EQPreset =
        mode === 'graphic'
          ? {
              id: genEqId(),
              name: name.trim() || 'Custom Preset',
              preamp,
              // Compiled snapshot so builds without graphic support (or corrupt
              // gains) still load an identical parametric preset.
              bands: buildGraphicBands(graphicGains).map((b) => ({ ...b, id: genEqId() })),
              mode: 'graphic',
              graphicGains: [...graphicGains],
              isCustom: true,
            }
          : {
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
      const graphicGains = preset.mode === 'graphic' ? parseGraphicGains(preset.graphicGains) : null;
      const stored: EQPreset = {
        id: genEqId(),
        name: preset.name,
        preamp: clampPreamp(preset.preamp),
        bands: preset.bands.slice(0, EQ_MAX_BANDS).map((band) => createNormalizedEQBand(band, genEqId())),
        isCustom: true,
        ...(graphicGains ? { mode: 'graphic' as const, graphicGains } : {}),
      };
      set({ presets: [...get().presets, stored] });
      get().applyPreset(stored.id);
    },

    setOutputRoute: async (route) => {
      if (!get().loaded) await get().load();

      const nextRoute = normalizeAudioOutputRoute(route);
      const previousRoute = get().activeOutputRoute;
      if (previousRoute?.key === nextRoute?.key) {
        if (
          previousRoute &&
          nextRoute &&
          (previousRoute.label !== nextRoute.label ||
            previousRoute.kind !== nextRoute.kind ||
            previousRoute.nativeId !== nextRoute.nativeId ||
            previousRoute.nativeType !== nextRoute.nativeType ||
            previousRoute.selectedRouteName !== nextRoute.selectedRouteName)
        ) {
          set({ activeOutputRoute: nextRoute });
          schedulePersist();
        }
        return;
      }

      captureRouteProfile(previousRoute);

      if (!nextRoute) {
        set({ activeOutputRoute: null });
        schedulePersist();
        return;
      }

      const profile = routeProfilesByKey[nextRoute.key];
      if (!profile) {
        // First-seen routes inherit whatever EQ is currently audible, then diverge
        // as soon as the user edits while this route is active.
        set({ activeOutputRoute: nextRoute });
        schedulePersist();
        return;
      }

      const restored = restoreEQRouteProfile(profile, (presetId) =>
        get().presets.some((preset) => preset.id === presetId)
      );
      set({
        activeOutputRoute: nextRoute,
        enabled: restored.enabled,
        preamp: restored.preamp,
        mode: restored.mode,
        bands: restored.bands,
        graphicGains: restored.graphicGains,
        activePresetId: restored.activePresetId,
        activeBandId: restored.bands[0]?.id ?? null,
      });
      syncToNative();
      schedulePersist();
    },

    _syncToNative: syncToNative,
  };
});

import { create } from 'zustand';
import { openLibraryDb } from '@/db/database';
import { getSetting, setSetting } from '@/db/queries';
import type { ArtistGroupingMode } from '@/library/artistGrouping';

/**
 * Persisted app preferences. SQLite (settings table) is the source of truth — this
 * store mirrors it in memory. Kept free of cross-store imports; libraryStore
 * subscribes here to recompute the artist list when the grouping mode changes.
 */
const ARTIST_GROUPING_KEY = 'artist_grouping_mode';
const SCOPE_MODE_KEY = 'scope_mode';
const SCOPE_STAGE_VISIBLE_KEY = 'scope_stage_visible';

/** Which visualizer the now-playing scope stage shows. */
export type ScopeMode = 'spectrum' | 'scope';

function parseGroupingMode(value: string | null): ArtistGroupingMode {
  return value === 'fileTags' ? 'fileTags' : 'astra';
}

function parseScopeMode(value: string | null): ScopeMode {
  return value === 'scope' ? 'scope' : 'spectrum';
}

function parseBoolean(value: string | null): boolean {
  return value === 'true';
}

interface SettingsStore {
  artistGroupingMode: ArtistGroupingMode;
  scopeMode: ScopeMode;
  scopeStageVisible: boolean;
  loaded: boolean;
  load: () => Promise<void>;
  setArtistGroupingMode: (mode: ArtistGroupingMode) => Promise<void>;
  setScopeMode: (mode: ScopeMode) => Promise<void>;
  setScopeStageVisible: (visible: boolean) => Promise<void>;
}

export const useSettingsStore = create<SettingsStore>((set, get) => ({
  artistGroupingMode: 'astra',
  scopeMode: 'spectrum',
  scopeStageVisible: false,
  loaded: false,

  load: async () => {
    if (get().loaded) return;
    const db = await openLibraryDb();
    const [grouping, scope, scopeStageVisible] = await Promise.all([
      getSetting(db, ARTIST_GROUPING_KEY),
      getSetting(db, SCOPE_MODE_KEY),
      getSetting(db, SCOPE_STAGE_VISIBLE_KEY),
    ]);
    set({
      artistGroupingMode: parseGroupingMode(grouping),
      scopeMode: parseScopeMode(scope),
      scopeStageVisible: parseBoolean(scopeStageVisible),
      loaded: true,
    });
  },

  setArtistGroupingMode: async (mode) => {
    if (get().artistGroupingMode === mode) return;
    set({ artistGroupingMode: mode });
    const db = await openLibraryDb();
    await setSetting(db, ARTIST_GROUPING_KEY, mode);
  },

  setScopeMode: async (mode) => {
    if (get().scopeMode === mode) return;
    set({ scopeMode: mode });
    const db = await openLibraryDb();
    await setSetting(db, SCOPE_MODE_KEY, mode);
  },

  setScopeStageVisible: async (visible) => {
    if (get().scopeStageVisible === visible) return;
    set({ scopeStageVisible: visible });
    const db = await openLibraryDb();
    await setSetting(db, SCOPE_STAGE_VISIBLE_KEY, visible ? 'true' : 'false');
  },
}));

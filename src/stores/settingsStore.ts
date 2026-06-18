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

/** Which visualizer the now-playing scope stage shows. */
export type ScopeMode = 'spectrum' | 'scope';

function parseGroupingMode(value: string | null): ArtistGroupingMode {
  return value === 'fileTags' ? 'fileTags' : 'astra';
}

function parseScopeMode(value: string | null): ScopeMode {
  return value === 'scope' ? 'scope' : 'spectrum';
}

interface SettingsStore {
  artistGroupingMode: ArtistGroupingMode;
  scopeMode: ScopeMode;
  loaded: boolean;
  load: () => Promise<void>;
  setArtistGroupingMode: (mode: ArtistGroupingMode) => Promise<void>;
  setScopeMode: (mode: ScopeMode) => Promise<void>;
}

export const useSettingsStore = create<SettingsStore>((set, get) => ({
  artistGroupingMode: 'astra',
  scopeMode: 'spectrum',
  loaded: false,

  load: async () => {
    if (get().loaded) return;
    const db = await openLibraryDb();
    const [grouping, scope] = await Promise.all([
      getSetting(db, ARTIST_GROUPING_KEY),
      getSetting(db, SCOPE_MODE_KEY),
    ]);
    set({
      artistGroupingMode: parseGroupingMode(grouping),
      scopeMode: parseScopeMode(scope),
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
}));

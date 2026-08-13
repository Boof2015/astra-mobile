import { create } from 'zustand';
import { AstraLibraryData } from '../../modules/astra-library-scanner';
import { useSettingsStore } from './settingsStore';

interface ArtistImageState {
  /** True while a sweep is draining the queue. */
  running: boolean;
  /** Artists resolved so far in the current sweep — one per provider request. */
  processed: number;
  /** Artists queued when the sweep started. 0 means "not counted yet". */
  total: number;
  /** Artists with no portrait from any source, refreshed when a sweep settles. */
  missing: number;
  beginSweep: (total: number) => void;
  advanceSweep: (by?: number) => void;
  endSweep: () => void;
  refreshMissing: () => Promise<void>;
}

/**
 * Observable progress for the artist-image sweep. The coordinator itself is a
 * plain module (it runs without any React tree mounted), so it pushes into this
 * store rather than owning the state — Settings just subscribes.
 */
export const useArtistImageStore = create<ArtistImageState>((set, get) => ({
  running: false,
  processed: 0,
  total: 0,
  missing: 0,

  beginSweep: (total) => set({ running: true, processed: 0, total }),

  advanceSweep: (by = 1) => set((state) => ({ processed: state.processed + by })),

  endSweep: () => {
    set({ running: false, processed: 0, total: 0 });
    void get().refreshMissing();
  },

  refreshMissing: async () => {
    try {
      const stats = await AstraLibraryData.getArtistImageStats(
        useSettingsStore.getState().artistGroupingMode,
        Date.now()
      );
      set({ missing: stats.missing });
    } catch {
      // A stale count is not worth surfacing an error for.
    }
  },
}));

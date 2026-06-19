import { create } from 'zustand';
import type { Album, Artist, DbTrack, LibraryFolder } from '@/types/library';
import { openLibraryDb } from '@/db/database';
import { getAlbums, getAllTracks, getTrackCount } from '@/db/queries';
import { ensureArtworkThumbnails } from '@/library/artwork';
import { buildArtistList } from '@/library/artistGrouping';
import {
  addFolderViaPicker,
  loadFolders,
  removeFolder as scannerRemoveFolder,
  rescanAll,
  type ScanProgress,
  type ScanResult,
} from '@/library/scanner';
import type { TrackSort } from '@/lib/trackSort';
import { usePlaylistStore } from './playlistStore';
import { useSettingsStore } from './settingsStore';

/**
 * Library state — SQLite is the source of truth (no persist middleware);
 * this store mirrors it in memory for the UI plus scan/UI state.
 */
type ViewMode = 'tracks' | 'albums' | 'artists' | 'playlists' | 'folders';

export type FolderWithCount = LibraryFolder & { track_count: number };

interface ScanProgressState {
  phase: 'idle' | 'discovering' | 'extracting' | 'analyzing';
  processed: number;
  total: number;
  folderName?: string;
}

const IDLE_PROGRESS: ScanProgressState = { phase: 'idle', processed: 0, total: 0 };

interface LibraryStore {
  initialized: boolean;
  tracks: DbTrack[];
  albums: Album[];
  artists: Artist[];
  folders: FolderWithCount[];
  totalTrackCount: number;
  viewMode: ViewMode;
  trackSort: TrackSort;
  isScanning: boolean;
  scanProgress: ScanProgressState;
  scanError: string | null;

  initialize: () => Promise<void>;
  refresh: () => Promise<void>;
  recomputeArtists: () => void;
  setViewMode: (mode: ViewMode) => void;
  setTrackSort: (sort: TrackSort) => void;
  addFolder: () => Promise<void>;
  removeFolder: (folderId: number) => Promise<void>;
  rescan: () => Promise<void>;
}

let initPromise: Promise<void> | null = null;

export const useLibraryStore = create<LibraryStore>((set, get) => {
  const onProgress = (progress: ScanProgress) => set({ scanProgress: progress });

  /** Shared scan wrapper: progress/error state + refresh, scans never overlap. */
  const runScan = async (scan: () => Promise<ScanResult | null>) => {
    if (get().isScanning) return;
    set({ isScanning: true, scanError: null, scanProgress: { ...IDLE_PROGRESS } });
    try {
      await scan();
    } catch (err) {
      set({ scanError: err instanceof Error ? err.message : String(err) });
    } finally {
      await get().refresh();
      set({ isScanning: false, scanProgress: { ...IDLE_PROGRESS } });
    }
  };

  return {
    initialized: false,
    tracks: [],
    albums: [],
    artists: [],
    folders: [],
    totalTrackCount: 0,
    viewMode: 'albums',
    trackSort: 'artist',
    isScanning: false,
    scanProgress: { ...IDLE_PROGRESS },
    scanError: null,

    initialize: () => {
      if (!initPromise) {
        initPromise = (async () => {
          const db = await openLibraryDb();
          // Load the persisted grouping mode before the first refresh so the artist
          // list is built correctly; recompute it whenever the mode changes later.
          await useSettingsStore.getState().load();
          useSettingsStore.subscribe((state, prev) => {
            if (state.artistGroupingMode !== prev.artistGroupingMode) get().recomputeArtists();
          });
          await get().refresh();
          set({ initialized: true });
          // One-time recovery: the v3 migration marks tracks stale (mtime = -1)
          // whose non-ASCII tags were truncated by the pre-fix op-sqlite binding.
          // Re-extract them now that binding is fixed. Fire-and-forget so startup
          // isn't blocked; rescan manages its own progress + refresh.
          const stale = await db.get<{ n: number }>('SELECT COUNT(*) AS n FROM tracks WHERE mtime = -1');
          if ((stale?.n ?? 0) > 0) {
            void get().rescan();
          }
        })().catch((err) => {
          initPromise = null; // allow retry on genuine failure
          throw err;
        });
      }
      return initPromise;
    },

    refresh: async () => {
      const db = await openLibraryDb();
      const [tracks, albums, folders, totalTrackCount] = await Promise.all([
        getAllTracks(db),
        getAlbums(db),
        loadFolders(),
        getTrackCount(db),
      ]);
      try {
        await ensureArtworkThumbnails(tracks.map((track) => track.artwork_hash));
      } catch {
        // Missing thumbnails should not prevent the library itself from loading.
      }
      // The artist list is derived in JS so it can honor the grouping mode.
      const artists = buildArtistList(tracks, useSettingsStore.getState().artistGroupingMode);
      set({ tracks, albums, artists, folders, totalTrackCount });
      // Playlist counts/missing states depend on tracks — keep them in step.
      await usePlaylistStore.getState().refresh();
    },

    // Rebuild the artist list from in-memory tracks (e.g. on grouping-mode change),
    // without re-querying SQLite.
    recomputeArtists: () =>
      set((state) => ({
        artists: buildArtistList(state.tracks, useSettingsStore.getState().artistGroupingMode),
      })),

    setViewMode: (viewMode) => set({ viewMode }),

    setTrackSort: (trackSort) => set({ trackSort }),

    addFolder: () => runScan(() => addFolderViaPicker({ onProgress })),

    removeFolder: async (folderId) => {
      const folder = get().folders.find((entry) => entry.id === folderId);
      if (!folder) return;
      await scannerRemoveFolder(folder);
      await get().refresh();
    },

    rescan: () => runScan(() => rescanAll({ callbacks: { onProgress } })),
  };
});

import { create } from 'zustand';
import type { Album, Artist, DbTrack, LibraryFolder } from '@/types/library';
import { openLibraryDb } from '@/db/database';
import { getAlbums, getAllTracks, getArtists, getTrackCount } from '@/db/queries';
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

/**
 * Library state — SQLite is the source of truth (no persist middleware);
 * this store mirrors it in memory for the UI plus scan/UI state.
 */
type ViewMode = 'tracks' | 'albums' | 'artists' | 'playlists' | 'folders';

export type FolderWithCount = LibraryFolder & { track_count: number };

interface ScanProgressState {
  phase: 'idle' | 'discovering' | 'extracting';
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
      const [tracks, albums, artists, folders, totalTrackCount] = await Promise.all([
        getAllTracks(db),
        getAlbums(db),
        getArtists(db),
        loadFolders(),
        getTrackCount(db),
      ]);
      set({ tracks, albums, artists, folders, totalTrackCount });
      // Playlist counts/missing states depend on tracks — keep them in step.
      await usePlaylistStore.getState().refresh();
    },

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

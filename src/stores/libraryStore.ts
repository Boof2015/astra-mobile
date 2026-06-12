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

/**
 * Library state — SQLite is the source of truth (no persist middleware);
 * this store mirrors it in memory for the UI plus scan/UI state.
 */
type ViewMode = 'tracks' | 'albums' | 'artists' | 'folders';

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
  isScanning: boolean;
  scanProgress: ScanProgressState;
  scanError: string | null;

  initialize: () => Promise<void>;
  refresh: () => Promise<void>;
  setViewMode: (mode: ViewMode) => void;
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
    isScanning: false,
    scanProgress: { ...IDLE_PROGRESS },
    scanError: null,

    initialize: () => {
      if (!initPromise) {
        initPromise = (async () => {
          await openLibraryDb();
          await get().refresh();
          set({ initialized: true });
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
    },

    setViewMode: (viewMode) => set({ viewMode }),

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

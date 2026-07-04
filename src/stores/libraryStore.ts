import { create } from 'zustand';
import type { Album, Artist, DbTrack, LibraryFolder } from '@/types/library';
import { openLibraryDb } from '@/db/database';
import {
  getAlbums,
  getAllTracks,
  getRecentlyPlayedTracks,
  getSetting,
  getTrackCount,
  markTrackPlayed,
  setSetting,
} from '@/db/queries';
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
import { ALBUM_SORT_LABELS, type AlbumSort } from '@/lib/albumSort';
import { ARTIST_SORT_LABELS, type ArtistSort } from '@/lib/artistSort';
import { TRACK_SORT_LABELS, type TrackSort } from '@/lib/trackSort';
import { usePlaylistStore } from './playlistStore';
import { useSettingsStore } from './settingsStore';

/**
 * Library state — SQLite is the source of truth (no persist middleware);
 * this store mirrors it in memory for the UI plus scan/UI state.
 */
type ViewMode = 'tracks' | 'albums' | 'artists' | 'playlists' | 'folders';

const VIEW_MODE_KEY = 'library_view_mode';
const TRACK_SORT_KEY = 'library_track_sort';
const ALBUM_SORT_KEY = 'library_album_sort';
const ARTIST_SORT_KEY = 'library_artist_sort';

const VIEW_MODES: readonly ViewMode[] = ['tracks', 'albums', 'artists', 'playlists', 'folders'];

function parseViewMode(value: string | null): ViewMode | null {
  return VIEW_MODES.includes(value as ViewMode) ? (value as ViewMode) : null;
}

function parseTrackSort(value: string | null): TrackSort | null {
  return value !== null && value in TRACK_SORT_LABELS ? (value as TrackSort) : null;
}

function parseAlbumSort(value: string | null): AlbumSort | null {
  return value !== null && value in ALBUM_SORT_LABELS ? (value as AlbumSort) : null;
}

function parseArtistSort(value: string | null): ArtistSort | null {
  return value !== null && value in ARTIST_SORT_LABELS ? (value as ArtistSort) : null;
}

/** Fire-and-forget settings write so view/sort switching stays synchronous. */
function persistSetting(key: string, value: string) {
  void openLibraryDb()
    .then((db) => setSetting(db, key, value))
    .catch(() => {
      // Losing a view preference write is harmless; never surface it.
    });
}

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
  recentlyPlayedTracks: DbTrack[];
  albums: Album[];
  artists: Artist[];
  folders: FolderWithCount[];
  totalTrackCount: number;
  viewMode: ViewMode;
  trackSort: TrackSort;
  albumSort: AlbumSort;
  artistSort: ArtistSort;
  isScanning: boolean;
  scanProgress: ScanProgressState;
  scanError: string | null;

  initialize: () => Promise<void>;
  refresh: () => Promise<void>;
  recordTrackPlayed: (path: string) => Promise<void>;
  recomputeArtists: () => void;
  setViewMode: (mode: ViewMode) => void;
  setTrackSort: (sort: TrackSort) => void;
  setAlbumSort: (sort: AlbumSort) => void;
  setArtistSort: (sort: ArtistSort) => void;
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
    recentlyPlayedTracks: [],
    albums: [],
    artists: [],
    folders: [],
    totalTrackCount: 0,
    viewMode: 'albums',
    trackSort: 'artist',
    albumSort: 'artist',
    artistSort: 'name',
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
          // Restore view preferences before the first render of the library screen.
          const [savedViewMode, savedTrackSort, savedAlbumSort, savedArtistSort] =
            await Promise.all([
              getSetting(db, VIEW_MODE_KEY),
              getSetting(db, TRACK_SORT_KEY),
              getSetting(db, ALBUM_SORT_KEY),
              getSetting(db, ARTIST_SORT_KEY),
            ]);
          const viewMode = parseViewMode(savedViewMode);
          const trackSort = parseTrackSort(savedTrackSort);
          const albumSort = parseAlbumSort(savedAlbumSort);
          const artistSort = parseArtistSort(savedArtistSort);
          if (viewMode || trackSort || albumSort || artistSort) {
            set({
              ...(viewMode ? { viewMode } : null),
              ...(trackSort ? { trackSort } : null),
              ...(albumSort ? { albumSort } : null),
              ...(artistSort ? { artistSort } : null),
            });
          }
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
      const [tracks, albums, folders, totalTrackCount, recentlyPlayedTracks] = await Promise.all([
        getAllTracks(db),
        getAlbums(db),
        loadFolders(),
        getTrackCount(db),
        getRecentlyPlayedTracks(db),
      ]);
      try {
        await ensureArtworkThumbnails(tracks.map((track) => track.artwork_hash));
      } catch {
        // Missing thumbnails should not prevent the library itself from loading.
      }
      // The artist list is derived in JS so it can honor the grouping mode.
      const artists = buildArtistList(tracks, useSettingsStore.getState().artistGroupingMode);
      set({ tracks, recentlyPlayedTracks, albums, artists, folders, totalTrackCount });
      // Playlist counts/missing states depend on tracks — keep them in step.
      await usePlaylistStore.getState().refresh();
    },

    recordTrackPlayed: async (path) => {
      const db = await openLibraryDb();
      const recorded = await markTrackPlayed(db, path);
      if (!recorded) return;
      const recentlyPlayedTracks = await getRecentlyPlayedTracks(db);
      set({ recentlyPlayedTracks });
    },

    // Rebuild the artist list from in-memory tracks (e.g. on grouping-mode change),
    // without re-querying SQLite.
    recomputeArtists: () =>
      set((state) => ({
        artists: buildArtistList(state.tracks, useSettingsStore.getState().artistGroupingMode),
      })),

    setViewMode: (viewMode) => {
      set({ viewMode });
      persistSetting(VIEW_MODE_KEY, viewMode);
    },

    setTrackSort: (trackSort) => {
      set({ trackSort });
      persistSetting(TRACK_SORT_KEY, trackSort);
    },

    setAlbumSort: (albumSort) => {
      set({ albumSort });
      persistSetting(ALBUM_SORT_KEY, albumSort);
    },

    setArtistSort: (artistSort) => {
      set({ artistSort });
      persistSetting(ARTIST_SORT_KEY, artistSort);
    },

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

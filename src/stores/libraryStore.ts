import { create } from 'zustand';
import {
  AstraLibraryData,
  type LibrarySectionAnchor,
  type LibraryStatus,
} from '../../modules/astra-library-scanner';
import type { Album, Artist, DbTrack, LibraryFolder } from '@/types/library';
import {
  addFolderViaPicker,
  loadFolders,
  removeFolder as scannerRemoveFolder,
  rescanAll,
  type ScanProgress,
  type ScanResult,
} from '@/library/scanner';
import { endScanService, reportScanProgress } from '@/library/scanService';
import { ALBUM_SORT_LABELS, type AlbumSort } from '@/lib/albumSort';
import { ARTIST_SORT_LABELS, type ArtistSort } from '@/lib/artistSort';
import { TRACK_SORT_LABELS, type TrackSort } from '@/lib/trackSort';
import { useSettingsStore } from './settingsStore';

type ViewMode = 'tracks' | 'albums' | 'artists' | 'playlists' | 'folders';

const VIEW_MODE_KEY = 'library_view_mode';
const TRACK_SORT_KEY = 'library_track_sort';
const ALBUM_SORT_KEY = 'library_album_sort';
const ARTIST_SORT_KEY = 'library_artist_sort';
const INCLUDE_COLLAB_ARTISTS_KEY = 'library_include_collab_artists';
const PAGE_SIZE = 100;
const MAX_WINDOW_ITEMS = PAGE_SIZE * 5;

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

function persistSetting(key: string, value: string) {
  void AstraLibraryData.setSettings({ [key]: value });
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
  status: LibraryStatus;
  recoveryNotice: string | null;
  tracks: DbTrack[];
  recentlyPlayedTracks: DbTrack[];
  albums: Album[];
  artists: Artist[];
  homeAlbums: Album[];
  homeArtists: Artist[];
  folders: FolderWithCount[];
  totalTrackCount: number;
  viewMode: ViewMode;
  trackSort: TrackSort;
  albumSort: AlbumSort;
  artistSort: ArtistSort;
  includeCollabArtists: boolean;
  isScanning: boolean;
  isPageLoading: boolean;
  scanProgress: ScanProgressState;
  scanError: string | null;
  trackNextCursor: string | null;
  albumNextCursor: string | null;
  artistNextCursor: string | null;
  sectionAnchors: LibrarySectionAnchor[];

  initialize: () => Promise<void>;
  refresh: () => Promise<void>;
  loadNextTracks: () => Promise<void>;
  loadNextAlbums: () => Promise<void>;
  loadNextArtists: () => Promise<void>;
  jumpToSection: (cursor: string) => Promise<void>;
  recordTrackPlayed: (path: string) => Promise<void>;
  recomputeArtists: () => void;
  recomputeAlbums: () => void;
  setViewMode: (mode: ViewMode) => void;
  setTrackSort: (sort: TrackSort) => void;
  setAlbumSort: (sort: AlbumSort) => void;
  setArtistSort: (sort: ArtistSort) => void;
  setIncludeCollabArtists: (include: boolean) => void;
  addFolder: () => Promise<void>;
  removeFolder: (folderId: number) => Promise<void>;
  rescan: () => Promise<void>;
  rebuildLocalIndex: () => Promise<void>;
}

let initPromise: Promise<void> | null = null;
let nativeSubscriptionsInstalled = false;

function appendWindow<T>(
  current: T[],
  incoming: T[],
  key: (item: T) => string
): T[] {
  const known = new Set(current.map(key));
  const merged = [...current, ...incoming.filter((item) => !known.has(key(item)))];
  return merged.length > MAX_WINDOW_ITEMS ? merged.slice(merged.length - MAX_WINDOW_ITEMS) : merged;
}

export const useLibraryStore = create<LibraryStore>((set, get) => {
  const onProgress = (progress: ScanProgress) => {
    set({ scanProgress: progress });
    void reportScanProgress(progress);
  };

  const readTrackPage = (cursor: string | null) =>
    AstraLibraryData.getTrackPage<DbTrack>(get().trackSort, cursor, PAGE_SIZE);

  const readAlbumPage = (cursor: string | null) =>
    AstraLibraryData.getAlbumPage<Album>(
      get().albumSort,
      useSettingsStore.getState().includeSingles,
      cursor,
      PAGE_SIZE
    );

  const readArtistPage = (cursor: string | null) =>
    AstraLibraryData.getArtistPage<Artist>(
      get().artistSort,
      useSettingsStore.getState().artistGroupingMode,
      get().includeCollabArtists,
      cursor,
      PAGE_SIZE
    );

  const resetTracks = async () => {
    const page = await readTrackPage(null);
    set({
      tracks: page.items ?? [],
      trackNextCursor: page.nextCursor ?? null,
      totalTrackCount: page.totalCount ?? 0,
    });
  };

  const resetAlbums = async () => {
    const page = await readAlbumPage(null);
    set({ albums: page.items ?? [], albumNextCursor: page.nextCursor ?? null });
  };

  const resetArtists = async () => {
    const page = await readArtistPage(null);
    set({ artists: page.items ?? [], artistNextCursor: page.nextCursor ?? null });
  };

  const resetSectionAnchors = async () => {
    const state = get();
    const sortable =
      (state.viewMode === 'tracks' && (state.trackSort === 'artist' || state.trackSort === 'title')) ||
      (state.viewMode === 'albums' && (state.albumSort === 'artist' || state.albumSort === 'name')) ||
      (state.viewMode === 'artists' && state.artistSort === 'name');
    if (!sortable) {
      set({ sectionAnchors: [] });
      return;
    }
    const sort =
      state.viewMode === 'tracks'
        ? state.trackSort as 'artist' | 'title'
        : state.viewMode === 'albums'
          ? state.albumSort as 'artist' | 'name'
          : 'name';
    set({
      sectionAnchors: await AstraLibraryData.getSectionAnchors(
        state.viewMode as 'tracks' | 'albums' | 'artists',
        sort,
        useSettingsStore.getState().includeSingles,
        useSettingsStore.getState().artistGroupingMode,
        state.includeCollabArtists
      ),
    });
  };

  const runScan = async (scan: () => Promise<ScanResult | null>) => {
    if (get().isScanning) return;
    set({ isScanning: true, scanError: null, scanProgress: { ...IDLE_PROGRESS } });
    try {
      await scan();
    } catch (error) {
      set({ scanError: error instanceof Error ? error.message : String(error) });
    } finally {
      try {
        await get().refresh();
      } finally {
        set({ isScanning: false, scanProgress: { ...IDLE_PROGRESS } });
        endScanService();
      }
    }
  };

  return {
    initialized: false,
    status: 'initializing',
    recoveryNotice: null,
    tracks: [],
    recentlyPlayedTracks: [],
    albums: [],
    artists: [],
    homeAlbums: [],
    homeArtists: [],
    folders: [],
    totalTrackCount: 0,
    viewMode: 'albums',
    trackSort: 'title',
    albumSort: 'name',
    artistSort: 'name',
    includeCollabArtists: false,
    isScanning: false,
    isPageLoading: false,
    scanProgress: { ...IDLE_PROGRESS },
    scanError: null,
    trackNextCursor: null,
    albumNextCursor: null,
    artistNextCursor: null,
    sectionAnchors: [],

    initialize: () => {
      if (!initPromise) {
        initPromise = (async () => {
          const status = await AstraLibraryData.initialize();
          set({
            status: status.status,
            recoveryNotice: status.recoveryNotice,
            totalTrackCount: status.trackCount,
          });
          if (status.status === 'fatalUserData') {
            set({ initialized: true });
            return;
          }
          await useSettingsStore.getState().load();
          const values = await AstraLibraryData.getSettings([
            VIEW_MODE_KEY,
            TRACK_SORT_KEY,
            ALBUM_SORT_KEY,
            ARTIST_SORT_KEY,
            INCLUDE_COLLAB_ARTISTS_KEY,
          ]);
          const viewMode = parseViewMode(values[VIEW_MODE_KEY] ?? null);
          const trackSort = parseTrackSort(values[TRACK_SORT_KEY] ?? null);
          const albumSort = parseAlbumSort(values[ALBUM_SORT_KEY] ?? null);
          const artistSort = parseArtistSort(values[ARTIST_SORT_KEY] ?? null);
          set({
            ...(viewMode ? { viewMode } : {}),
            ...(trackSort ? { trackSort } : {}),
            ...(albumSort ? { albumSort } : {}),
            ...(artistSort ? { artistSort } : {}),
            includeCollabArtists: values[INCLUDE_COLLAB_ARTISTS_KEY] === 'true',
          });

          if (!nativeSubscriptionsInstalled) {
            nativeSubscriptionsInstalled = true;
            AstraLibraryData.addListener('onLibraryStatus', (next) => {
              set({
                status: next.status,
                recoveryNotice: next.recoveryNotice,
                totalTrackCount: next.trackCount,
              });
              if (next.status === 'rebuilding' && !get().isScanning) {
                void get().rebuildLocalIndex();
              }
            });
            AstraLibraryData.addListener('onCatalogChanged', () => {
              void get().refresh();
            });
            useSettingsStore.subscribe((next, previous) => {
              if (next.artistGroupingMode !== previous.artistGroupingMode) {
                void resetArtists();
                void resetSectionAnchors();
              }
              if (next.includeSingles !== previous.includeSingles) {
                void resetAlbums();
                void resetSectionAnchors();
              }
            });
          }

          await get().refresh();
          set({ initialized: true });
          if (status.status === 'rebuilding' && !get().isScanning) {
            void get().rebuildLocalIndex();
          }
        })().catch((error) => {
          initPromise = null;
          throw error;
        });
      }
      return initPromise;
    },

    refresh: async () => {
      const viewMode = get().viewMode;
      const [
        trackPage,
        albumPage,
        artistPage,
        homeAlbumPage,
        homeArtistPage,
        folders,
        recentlyPlayedTracks,
      ] = await Promise.all([
        viewMode === 'tracks' ? readTrackPage(null) : Promise.resolve(null),
        viewMode === 'albums' ? readAlbumPage(null) : Promise.resolve(null),
        viewMode === 'artists' ? readArtistPage(null) : Promise.resolve(null),
        AstraLibraryData.getAlbumPage<Album>(
          'recently_added',
          useSettingsStore.getState().includeSingles,
          null,
          20
        ),
        AstraLibraryData.getArtistPage<Artist>(
          'name',
          useSettingsStore.getState().artistGroupingMode,
          get().includeCollabArtists,
          null,
          50
        ),
        loadFolders(),
        AstraLibraryData.getRecentlyPlayed<DbTrack>(20),
      ]);
      set({
        ...(trackPage ? {
          tracks: trackPage.items ?? [],
          trackNextCursor: trackPage.nextCursor ?? null,
          totalTrackCount: trackPage.totalCount ?? get().totalTrackCount,
        } : {}),
        ...(albumPage ? {
          albums: albumPage.items ?? [],
          albumNextCursor: albumPage.nextCursor ?? null,
        } : {}),
        ...(artistPage ? {
          artists: artistPage.items ?? [],
          artistNextCursor: artistPage.nextCursor ?? null,
        } : {}),
        homeAlbums: homeAlbumPage.items ?? [],
        homeArtists: homeArtistPage.items ?? [],
        folders,
        recentlyPlayedTracks,
      });
      await resetSectionAnchors();
    },

    loadNextTracks: async () => {
      const cursor = get().trackNextCursor;
      if (!cursor || get().isPageLoading) return;
      set({ isPageLoading: true });
      try {
        const page = await readTrackPage(cursor);
        if (page.error === 'STALE_REVISION') return resetTracks();
        set((state) => ({
          tracks: appendWindow(state.tracks, page.items, (track) => track.path),
          trackNextCursor: page.nextCursor,
        }));
      } finally {
        set({ isPageLoading: false });
      }
    },

    loadNextAlbums: async () => {
      const cursor = get().albumNextCursor;
      if (!cursor || get().isPageLoading) return;
      set({ isPageLoading: true });
      try {
        const page = await readAlbumPage(cursor);
        if (page.error === 'STALE_REVISION') return resetAlbums();
        set((state) => ({
          albums: appendWindow(state.albums, page.items, (album) => album.identity_key),
          albumNextCursor: page.nextCursor,
        }));
      } finally {
        set({ isPageLoading: false });
      }
    },

    loadNextArtists: async () => {
      const cursor = get().artistNextCursor;
      if (!cursor || get().isPageLoading) return;
      set({ isPageLoading: true });
      try {
        const page = await readArtistPage(cursor);
        if (page.error === 'STALE_REVISION') return resetArtists();
        set((state) => ({
          artists: appendWindow(state.artists, page.items, (artist) => artist.artist),
          artistNextCursor: page.nextCursor,
        }));
      } finally {
        set({ isPageLoading: false });
      }
    },

    jumpToSection: async (cursor) => {
      const state = get();
      set({ isPageLoading: true });
      try {
        if (state.viewMode === 'tracks') {
          const page = await readTrackPage(cursor);
          if (page.error === 'STALE_REVISION') return resetTracks();
          set({
            tracks: page.items,
            trackNextCursor: page.nextCursor,
            totalTrackCount: page.totalCount,
          });
        } else if (state.viewMode === 'albums') {
          const page = await readAlbumPage(cursor);
          if (page.error === 'STALE_REVISION') return resetAlbums();
          set({ albums: page.items, albumNextCursor: page.nextCursor });
        } else if (state.viewMode === 'artists') {
          const page = await readArtistPage(cursor);
          if (page.error === 'STALE_REVISION') return resetArtists();
          set({ artists: page.items, artistNextCursor: page.nextCursor });
        }
      } finally {
        set({ isPageLoading: false });
      }
    },

    recordTrackPlayed: async (path) => {
      await AstraLibraryData.recordTrackPlayed(path);
      set({ recentlyPlayedTracks: await AstraLibraryData.getRecentlyPlayed<DbTrack>(20) });
    },

    recomputeArtists: () => {
      void resetArtists();
    },

    recomputeAlbums: () => {
      void resetAlbums();
    },

    setViewMode: (viewMode) => {
      set({ viewMode });
      persistSetting(VIEW_MODE_KEY, viewMode);
      if (viewMode === 'tracks' && get().tracks.length === 0) void resetTracks();
      if (viewMode === 'albums' && get().albums.length === 0) void resetAlbums();
      if (viewMode === 'artists' && get().artists.length === 0) void resetArtists();
      void resetSectionAnchors();
    },

    setTrackSort: (trackSort) => {
      set({ trackSort, tracks: [], trackNextCursor: null });
      persistSetting(TRACK_SORT_KEY, trackSort);
      void resetTracks();
      void resetSectionAnchors();
    },

    setAlbumSort: (albumSort) => {
      set({ albumSort, albums: [], albumNextCursor: null });
      persistSetting(ALBUM_SORT_KEY, albumSort);
      void resetAlbums();
      void resetSectionAnchors();
    },

    setArtistSort: (artistSort) => {
      set({ artistSort, artists: [], artistNextCursor: null });
      persistSetting(ARTIST_SORT_KEY, artistSort);
      void resetArtists();
      void resetSectionAnchors();
    },

    setIncludeCollabArtists: (includeCollabArtists) => {
      set({ includeCollabArtists, artists: [], artistNextCursor: null });
      persistSetting(INCLUDE_COLLAB_ARTISTS_KEY, includeCollabArtists ? 'true' : 'false');
      void resetArtists();
      void resetSectionAnchors();
    },

    addFolder: () => runScan(() => addFolderViaPicker({ onProgress })),

    removeFolder: async (folderId) => {
      const folder = get().folders.find((entry) => entry.id === folderId);
      if (!folder) return;
      await scannerRemoveFolder(folder);
      await get().refresh();
    },

    rescan: () => runScan(() => rescanAll({ callbacks: { onProgress } })),

    rebuildLocalIndex: () => runScan(() => rescanAll({ mode: 'full', callbacks: { onProgress } })),
  };
});

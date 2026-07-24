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
  sectionJumpRevision: number;

  initialize: () => Promise<void>;
  refresh: () => Promise<void>;
  loadNextTracks: () => Promise<void>;
  loadNextAlbums: () => Promise<void>;
  loadNextArtists: () => Promise<void>;
  jumpToSection: (cursor: string) => Promise<boolean>;
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
  const pageGenerations = {
    tracks: 0,
    albums: 0,
    artists: 0,
  };
  let anchorGeneration = 0;
  let loadingGeneration = 0;

  const beginLoading = () => {
    const generation = ++loadingGeneration;
    set({ isPageLoading: true });
    return generation;
  };

  const finishLoading = (generation: number) => {
    if (generation === loadingGeneration) set({ isPageLoading: false });
  };

  const onProgress = (progress: ScanProgress) => {
    set({ scanProgress: progress });
    void reportScanProgress(progress);
  };

  const readTrackPage = (
    cursor: string | null,
    sort = get().trackSort,
  ) => AstraLibraryData.getTrackPage<DbTrack>(sort, cursor, PAGE_SIZE);

  const readAlbumPage = (
    cursor: string | null,
    sort = get().albumSort,
    includeSingles = useSettingsStore.getState().includeSingles,
  ) =>
    AstraLibraryData.getAlbumPage<Album>(
      sort,
      includeSingles,
      cursor,
      PAGE_SIZE
    );

  const readArtistPage = (
    cursor: string | null,
    sort = get().artistSort,
    groupingMode = useSettingsStore.getState().artistGroupingMode,
    includeCollaborations = get().includeCollabArtists,
  ) =>
    AstraLibraryData.getArtistPage<Artist>(
      sort,
      groupingMode,
      includeCollaborations,
      cursor,
      PAGE_SIZE
    );

  const resetTracks = async () => {
    const sort = get().trackSort;
    const generation = ++pageGenerations.tracks;
    const page = await readTrackPage(null, sort);
    if (generation !== pageGenerations.tracks || get().trackSort !== sort) return false;
    set({
      tracks: page.items ?? [],
      trackNextCursor: page.nextCursor ?? null,
      totalTrackCount: page.totalCount ?? 0,
    });
    return true;
  };

  const resetAlbums = async () => {
    const sort = get().albumSort;
    const includeSingles = useSettingsStore.getState().includeSingles;
    const generation = ++pageGenerations.albums;
    const page = await readAlbumPage(null, sort, includeSingles);
    if (
      generation !== pageGenerations.albums ||
      get().albumSort !== sort ||
      useSettingsStore.getState().includeSingles !== includeSingles
    ) return false;
    set({ albums: page.items ?? [], albumNextCursor: page.nextCursor ?? null });
    return true;
  };

  const resetArtists = async () => {
    const sort = get().artistSort;
    const groupingMode = useSettingsStore.getState().artistGroupingMode;
    const includeCollaborations = get().includeCollabArtists;
    const generation = ++pageGenerations.artists;
    const page = await readArtistPage(null, sort, groupingMode, includeCollaborations);
    if (
      generation !== pageGenerations.artists ||
      get().artistSort !== sort ||
      useSettingsStore.getState().artistGroupingMode !== groupingMode ||
      get().includeCollabArtists !== includeCollaborations
    ) return false;
    set({ artists: page.items ?? [], artistNextCursor: page.nextCursor ?? null });
    return true;
  };

  const resetSectionAnchors = async () => {
    const generation = ++anchorGeneration;
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
    const includeSingles = useSettingsStore.getState().includeSingles;
    const groupingMode = useSettingsStore.getState().artistGroupingMode;
    const anchors = await AstraLibraryData.getSectionAnchors(
      state.viewMode as 'tracks' | 'albums' | 'artists',
      sort,
      includeSingles,
      groupingMode,
      state.includeCollabArtists
    );
    const current = get();
    const currentSort =
      current.viewMode === 'tracks'
        ? current.trackSort
        : current.viewMode === 'albums'
          ? current.albumSort
          : current.artistSort;
    if (
      generation !== anchorGeneration ||
      current.viewMode !== state.viewMode ||
      currentSort !== sort ||
      useSettingsStore.getState().includeSingles !== includeSingles ||
      useSettingsStore.getState().artistGroupingMode !== groupingMode ||
      current.includeCollabArtists !== state.includeCollabArtists
    ) return;
    set({ sectionAnchors: anchors });
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
    sectionJumpRevision: 0,

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
              anchorGeneration += 1;
              set({ sectionAnchors: [] });
              void get().refresh();
            });
            useSettingsStore.subscribe((next, previous) => {
              if (next.artistGroupingMode !== previous.artistGroupingMode) {
                anchorGeneration += 1;
                set({ sectionAnchors: [] });
                void resetArtists();
                void resetSectionAnchors();
              }
              if (next.includeSingles !== previous.includeSingles) {
                anchorGeneration += 1;
                set({ sectionAnchors: [] });
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
      const stateAtStart = get();
      const viewMode = stateAtStart.viewMode;
      const trackSort = stateAtStart.trackSort;
      const albumSort = stateAtStart.albumSort;
      const artistSort = stateAtStart.artistSort;
      const includeSingles = useSettingsStore.getState().includeSingles;
      const groupingMode = useSettingsStore.getState().artistGroupingMode;
      const includeCollaborations = stateAtStart.includeCollabArtists;
      const activeGeneration =
        viewMode === 'tracks'
          ? ++pageGenerations.tracks
          : viewMode === 'albums'
            ? ++pageGenerations.albums
            : viewMode === 'artists'
              ? ++pageGenerations.artists
              : null;
      const [
        trackPage,
        albumPage,
        artistPage,
        homeAlbumPage,
        homeArtistPage,
        folders,
        recentlyPlayedTracks,
      ] = await Promise.all([
        viewMode === 'tracks' ? readTrackPage(null, trackSort) : Promise.resolve(null),
        viewMode === 'albums'
          ? readAlbumPage(null, albumSort, includeSingles)
          : Promise.resolve(null),
        viewMode === 'artists'
          ? readArtistPage(null, artistSort, groupingMode, includeCollaborations)
          : Promise.resolve(null),
        AstraLibraryData.getAlbumPage<Album>(
          'recently_added',
          includeSingles,
          null,
          20
        ),
        AstraLibraryData.getArtistPage<Artist>(
          'name',
          groupingMode,
          includeCollaborations,
          null,
          50
        ),
        loadFolders(),
        AstraLibraryData.getRecentlyPlayed<DbTrack>(20),
      ]);
      const current = get();
      const canApplyTrackPage =
        viewMode === 'tracks' &&
        current.viewMode === 'tracks' &&
        current.trackSort === trackSort &&
        activeGeneration === pageGenerations.tracks;
      const canApplyAlbumPage =
        viewMode === 'albums' &&
        current.viewMode === 'albums' &&
        current.albumSort === albumSort &&
        useSettingsStore.getState().includeSingles === includeSingles &&
        activeGeneration === pageGenerations.albums;
      const canApplyArtistPage =
        viewMode === 'artists' &&
        current.viewMode === 'artists' &&
        current.artistSort === artistSort &&
        useSettingsStore.getState().artistGroupingMode === groupingMode &&
        current.includeCollabArtists === includeCollaborations &&
        activeGeneration === pageGenerations.artists;
      set({
        ...(trackPage && canApplyTrackPage ? {
          tracks: trackPage.items ?? [],
          trackNextCursor: trackPage.nextCursor ?? null,
          totalTrackCount: trackPage.totalCount ?? current.totalTrackCount,
        } : {}),
        ...(albumPage && canApplyAlbumPage ? {
          albums: albumPage.items ?? [],
          albumNextCursor: albumPage.nextCursor ?? null,
        } : {}),
        ...(artistPage && canApplyArtistPage ? {
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
      const state = get();
      const cursor = state.trackNextCursor;
      if (!cursor || state.isPageLoading) return;
      const sort = state.trackSort;
      const pageGeneration = pageGenerations.tracks;
      const loading = beginLoading();
      try {
        const page = await readTrackPage(cursor, sort);
        if (
          pageGeneration !== pageGenerations.tracks ||
          get().trackSort !== sort ||
          get().trackNextCursor !== cursor
        ) return;
        if (page.error === 'STALE_REVISION') {
          await resetTracks();
          return;
        }
        set((state) => ({
          tracks: appendWindow(state.tracks, page.items, (track) => track.path),
          trackNextCursor: page.nextCursor,
        }));
      } finally {
        finishLoading(loading);
      }
    },

    loadNextAlbums: async () => {
      const state = get();
      const cursor = state.albumNextCursor;
      if (!cursor || state.isPageLoading) return;
      const sort = state.albumSort;
      const includeSingles = useSettingsStore.getState().includeSingles;
      const pageGeneration = pageGenerations.albums;
      const loading = beginLoading();
      try {
        const page = await readAlbumPage(cursor, sort, includeSingles);
        if (
          pageGeneration !== pageGenerations.albums ||
          get().albumSort !== sort ||
          useSettingsStore.getState().includeSingles !== includeSingles ||
          get().albumNextCursor !== cursor
        ) return;
        if (page.error === 'STALE_REVISION') {
          await resetAlbums();
          return;
        }
        set((state) => ({
          albums: appendWindow(state.albums, page.items, (album) => album.identity_key),
          albumNextCursor: page.nextCursor,
        }));
      } finally {
        finishLoading(loading);
      }
    },

    loadNextArtists: async () => {
      const state = get();
      const cursor = state.artistNextCursor;
      if (!cursor || state.isPageLoading) return;
      const sort = state.artistSort;
      const groupingMode = useSettingsStore.getState().artistGroupingMode;
      const includeCollaborations = state.includeCollabArtists;
      const pageGeneration = pageGenerations.artists;
      const loading = beginLoading();
      try {
        const page = await readArtistPage(cursor, sort, groupingMode, includeCollaborations);
        if (
          pageGeneration !== pageGenerations.artists ||
          get().artistSort !== sort ||
          useSettingsStore.getState().artistGroupingMode !== groupingMode ||
          get().includeCollabArtists !== includeCollaborations ||
          get().artistNextCursor !== cursor
        ) return;
        if (page.error === 'STALE_REVISION') {
          await resetArtists();
          return;
        }
        set((state) => ({
          artists: appendWindow(state.artists, page.items, (artist) => artist.artist),
          artistNextCursor: page.nextCursor,
        }));
      } finally {
        finishLoading(loading);
      }
    },

    jumpToSection: async (cursor) => {
      const state = get();
      const viewMode = state.viewMode;
      if (viewMode !== 'tracks' && viewMode !== 'albums' && viewMode !== 'artists') return false;
      const generation = ++pageGenerations[viewMode];
      const loading = beginLoading();
      try {
        if (viewMode === 'tracks') {
          const sort = state.trackSort;
          const page = await readTrackPage(cursor, sort);
          if (
            generation !== pageGenerations.tracks ||
            get().viewMode !== viewMode ||
            get().trackSort !== sort
          ) return false;
          if (page.error === 'STALE_REVISION') {
            await resetTracks();
            return false;
          }
          if (page.items.length === 0) {
            void resetSectionAnchors();
            return false;
          }
          set((current) => ({
            tracks: page.items,
            trackNextCursor: page.nextCursor,
            totalTrackCount: page.totalCount,
            sectionJumpRevision: current.sectionJumpRevision + 1,
          }));
        } else if (viewMode === 'albums') {
          const sort = state.albumSort;
          const includeSingles = useSettingsStore.getState().includeSingles;
          const page = await readAlbumPage(cursor, sort, includeSingles);
          if (
            generation !== pageGenerations.albums ||
            get().viewMode !== viewMode ||
            get().albumSort !== sort ||
            useSettingsStore.getState().includeSingles !== includeSingles
          ) return false;
          if (page.error === 'STALE_REVISION') {
            await resetAlbums();
            return false;
          }
          if (page.items.length === 0) {
            void resetSectionAnchors();
            return false;
          }
          set((current) => ({
            albums: page.items,
            albumNextCursor: page.nextCursor,
            sectionJumpRevision: current.sectionJumpRevision + 1,
          }));
        } else {
          const sort = state.artistSort;
          const groupingMode = useSettingsStore.getState().artistGroupingMode;
          const includeCollaborations = state.includeCollabArtists;
          const page = await readArtistPage(
            cursor,
            sort,
            groupingMode,
            includeCollaborations,
          );
          if (
            generation !== pageGenerations.artists ||
            get().viewMode !== viewMode ||
            get().artistSort !== sort ||
            useSettingsStore.getState().artistGroupingMode !== groupingMode ||
            get().includeCollabArtists !== includeCollaborations
          ) return false;
          if (page.error === 'STALE_REVISION') {
            await resetArtists();
            return false;
          }
          if (page.items.length === 0) {
            void resetSectionAnchors();
            return false;
          }
          set((current) => ({
            artists: page.items,
            artistNextCursor: page.nextCursor,
            sectionJumpRevision: current.sectionJumpRevision + 1,
          }));
        }
        return true;
      } finally {
        finishLoading(loading);
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
      anchorGeneration += 1;
      set({ viewMode, sectionAnchors: [] });
      persistSetting(VIEW_MODE_KEY, viewMode);
      if (viewMode === 'tracks' && get().tracks.length === 0) void resetTracks();
      if (viewMode === 'albums' && get().albums.length === 0) void resetAlbums();
      if (viewMode === 'artists' && get().artists.length === 0) void resetArtists();
      void resetSectionAnchors();
    },

    setTrackSort: (trackSort) => {
      anchorGeneration += 1;
      set({ trackSort, tracks: [], trackNextCursor: null, sectionAnchors: [] });
      persistSetting(TRACK_SORT_KEY, trackSort);
      void resetTracks();
      void resetSectionAnchors();
    },

    setAlbumSort: (albumSort) => {
      anchorGeneration += 1;
      set({ albumSort, albums: [], albumNextCursor: null, sectionAnchors: [] });
      persistSetting(ALBUM_SORT_KEY, albumSort);
      void resetAlbums();
      void resetSectionAnchors();
    },

    setArtistSort: (artistSort) => {
      anchorGeneration += 1;
      set({ artistSort, artists: [], artistNextCursor: null, sectionAnchors: [] });
      persistSetting(ARTIST_SORT_KEY, artistSort);
      void resetArtists();
      void resetSectionAnchors();
    },

    setIncludeCollabArtists: (includeCollabArtists) => {
      anchorGeneration += 1;
      set({
        includeCollabArtists,
        artists: [],
        artistNextCursor: null,
        sectionAnchors: [],
      });
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

import { create } from 'zustand';
import {
  AstraLibraryData,
  type LibrarySectionAnchor,
  type LibraryStatus,
} from '../../modules/astra-library-scanner';
import type { Album, Artist, DbTrack, LibraryFolder } from '@/types/library';
import {
  addFolderViaPicker,
  cancelActiveScan,
  createScanCancellationController,
  loadFolders,
  removeFolder as scannerRemoveFolder,
  rescanAll,
  type ScanCancellationSignal,
  type ScanProgress,
  type ScanResult,
} from '@/library/scanner';
import { endScanService, reportScanProgress } from '@/library/scanService';
import { requeueMissingArtistImages } from '@/library/artistImageLookup';
import {
  ALBUM_SORT_LABELS,
  ALBUM_SORT_LEGACY_DIRECTIONS,
  type AlbumSort,
} from '@/lib/albumSort';
import {
  ARTIST_SORT_LABELS,
  ARTIST_SORT_LEGACY_DIRECTIONS,
  type ArtistSort,
} from '@/lib/artistSort';
import {
  TRACK_SORT_LABELS,
  TRACK_SORT_LEGACY_DIRECTIONS,
  type TrackSort,
} from '@/lib/trackSort';
import { parseSortDirection, type SortDirection } from '@/lib/sortDirection';
import {
  DEFAULT_LIBRARY_LAYOUT,
  parseLibraryLayout,
  type LibraryLayout,
} from '@/library/libraryLayout';
import type { LibraryViewMode } from '@/library/libraryViewMode';
import { useSettingsStore } from './settingsStore';

type ViewMode = LibraryViewMode;

const VIEW_MODE_KEY = 'library_view_mode';
const TRACK_SORT_KEY = 'library_track_sort';
const ALBUM_SORT_KEY = 'library_album_sort';
const ARTIST_SORT_KEY = 'library_artist_sort';
const TRACK_SORT_DIRECTION_KEY = 'library_track_sort_direction';
const ALBUM_SORT_DIRECTION_KEY = 'library_album_sort_direction';
const ARTIST_SORT_DIRECTION_KEY = 'library_artist_sort_direction';
const ALBUM_LAYOUT_KEY = 'library_album_layout';
const ARTIST_LAYOUT_KEY = 'library_artist_layout';
const INCLUDE_COLLAB_ARTISTS_KEY = 'library_include_collab_artists';
const PAGE_SIZE = 200;

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

export type FolderWithCount = LibraryFolder & {
  track_count: number;
  needs_metadata_reindex?: boolean;
};

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
  trackSortDirection: SortDirection;
  albumSortDirection: SortDirection;
  artistSortDirection: SortDirection;
  albumLayout: LibraryLayout;
  artistLayout: LibraryLayout;
  includeCollabArtists: boolean;
  isScanning: boolean;
  isCancelling: boolean;
  scanProgress: ScanProgressState;
  scanError: string | null;
  trackNextCursor: string | null;
  albumNextCursor: string | null;
  artistNextCursor: string | null;
  /** Non-null only after a rail jump left rows above the loaded window. */
  trackPrevCursor: string | null;
  albumPrevCursor: string | null;
  artistPrevCursor: string | null;
  sectionAnchors: LibrarySectionAnchor[];
  sectionJumpRevision: number;
  /**
   * Where the jumped-to letter sits in the freshly built window — fed to the list's
   * `initialScrollIndex` on the remount that `sectionJumpRevision` triggers, so the
   * letter lands at the top with a page of rows already above it to scroll back into.
   */
  jumpAnchorIndex: number;

  initialize: () => Promise<void>;
  refresh: () => Promise<void>;
  loadNextTracks: () => Promise<void>;
  loadNextAlbums: () => Promise<void>;
  loadNextArtists: () => Promise<void>;
  loadPreviousTracks: () => Promise<void>;
  loadPreviousAlbums: () => Promise<void>;
  loadPreviousArtists: () => Promise<void>;
  jumpToSection: (cursor: string) => Promise<boolean>;
  rewindToHead: () => Promise<boolean>;
  recordTrackPlayed: (path: string) => Promise<void>;
  refreshRecentlyPlayed: () => Promise<void>;
  recomputeArtists: () => void;
  recomputeAlbums: () => void;
  setViewMode: (mode: ViewMode) => void;
  setTrackSort: (sort: TrackSort) => void;
  setAlbumSort: (sort: AlbumSort) => void;
  setArtistSort: (sort: ArtistSort) => void;
  setTrackSortDirection: (direction: SortDirection) => void;
  setAlbumSortDirection: (direction: SortDirection) => void;
  setArtistSortDirection: (direction: SortDirection) => void;
  setAlbumLayout: (layout: LibraryLayout) => void;
  setArtistLayout: (layout: LibraryLayout) => void;
  setIncludeCollabArtists: (include: boolean) => void;
  addFolder: () => Promise<void>;
  removeFolder: (folderId: number) => Promise<void>;
  rescan: () => Promise<void>;
  rebuildLocalIndex: () => Promise<void>;
  cancelScan: () => void;
}

let initPromise: Promise<void> | null = null;
let nativeSubscriptionsInstalled = false;
let activeScanCancellation: ReturnType<typeof createScanCancellationController> | null = null;

// These grow without a cap on purpose. A sliding window that dropped items off the
// head shrank the content height mid-scroll, which read as the list flinging itself
// to the bottom (worst on the 3-column grids, where dropping a page is not a whole
// number of rows), and left rows above unreachable. Worst case is the whole catalog
// in memory — what the pre-Room build did unconditionally — and only for a list you
// actually scrolled end to end.
function appendWindow<T>(
  current: T[],
  incoming: T[],
  key: (item: T) => string
): T[] {
  const known = new Set(current.map(key));
  return [...current, ...incoming.filter((item) => !known.has(key(item)))];
}

function prependWindow<T>(
  current: T[],
  incoming: T[],
  key: (item: T) => string
): T[] {
  const known = new Set(current.map(key));
  return [...incoming.filter((item) => !known.has(key(item))), ...current];
}

/**
 * Dropping back to page 1 under a live scroll offset leaves the list looking at an
 * offset past the new content end, which lands the user at the bottom of a list they
 * were reading the middle of. Bumping the revision remounts it (the revision is part
 * of the list's key) so it comes back at the top instead.
 */
function remountIfShorter(
  current: { sectionJumpRevision: number },
  previousLength: number,
  nextLength: number,
  force = false
): { sectionJumpRevision: number } | Record<string, never> {
  return force || previousLength > nextLength
    ? { sectionJumpRevision: current.sectionJumpRevision + 1 }
    : {};
}

export const useLibraryStore = create<LibraryStore>((set, get) => {
  const pageGenerations = {
    tracks: 0,
    albums: 0,
    artists: 0,
  };
  let anchorGeneration = 0;
  let artistImageRefreshTimer: ReturnType<typeof setTimeout> | null = null;

  // Re-entrancy guards, per list and per direction, so a backward refill, a forward
  // page and a different view's load never block one another — the single shared flag
  // this replaced serialised all three lists and made outrunning the loader likelier.
  // A jump needs no guard: it bumps the list's generation, which voids anything already
  // in flight.
  type ListKey = 'tracks' | 'albums' | 'artists';
  const forwardBusy: Record<ListKey, boolean> = { tracks: false, albums: false, artists: false };
  const backwardBusy: Record<ListKey, boolean> = { tracks: false, albums: false, artists: false };

  const onProgress = (progress: ScanProgress) => {
    set({ scanProgress: progress });
    void reportScanProgress(progress);
  };

  const readTrackPage = (
    cursor: string | null,
    sort = get().trackSort,
    direction = get().trackSortDirection,
  ) => AstraLibraryData.getTrackPage<DbTrack>(sort, direction, cursor, PAGE_SIZE);

  const readAlbumPage = (
    cursor: string | null,
    sort = get().albumSort,
    direction = get().albumSortDirection,
    includeSingles = useSettingsStore.getState().includeSingles,
  ) =>
    AstraLibraryData.getAlbumPage<Album>(
      sort,
      direction,
      includeSingles,
      cursor,
      PAGE_SIZE
    );

  const readArtistPage = (
    cursor: string | null,
    sort = get().artistSort,
    direction = get().artistSortDirection,
    groupingMode = useSettingsStore.getState().artistGroupingMode,
    includeCollaborations = get().includeCollabArtists,
  ) =>
    AstraLibraryData.getArtistPage<Artist>(
      sort,
      direction,
      groupingMode,
      includeCollaborations,
      cursor,
      PAGE_SIZE
    );

  // Backward readers only exist for the sorts the A-Z rail is offered for, which are
  // the only sorts a jump can leave rows above the window in.
  const readTrackPageBefore = (
    cursor: string,
    sort: 'artist' | 'title',
    direction = get().trackSortDirection,
  ) => AstraLibraryData.getTrackPageBefore<DbTrack>(sort, direction, cursor, PAGE_SIZE);

  const readAlbumPageBefore = (
    cursor: string,
    sort: 'artist' | 'name',
    direction = get().albumSortDirection,
    includeSingles = useSettingsStore.getState().includeSingles,
  ) => AstraLibraryData.getAlbumPageBefore<Album>(sort, direction, includeSingles, cursor, PAGE_SIZE);

  const readArtistPageBefore = (
    cursor: string,
    direction = get().artistSortDirection,
    groupingMode = useSettingsStore.getState().artistGroupingMode,
    includeCollaborations = get().includeCollabArtists,
  ) =>
    AstraLibraryData.getArtistPageBefore<Artist>(
      'name',
      direction,
      groupingMode,
      includeCollaborations,
      cursor,
      PAGE_SIZE
    );

  const backwardTrackSort = (sort: TrackSort): 'artist' | 'title' | null =>
    sort === 'artist' || sort === 'title' ? sort : null;

  const backwardAlbumSort = (sort: AlbumSort): 'artist' | 'name' | null =>
    sort === 'artist' || sort === 'name' ? sort : null;

  // `forceRemount` is for `rewindToHead`: the conditional remount above only
  // fires when page 1 is *shorter* than the window it replaces, which happens to
  // hold after a rail jump but is arithmetic the caller cannot verify — and a
  // PAGE_SIZE change would break it silently, leaving the list parked mid-catalog.
  const resetTracks = async (forceRemount = false) => {
    const sort = get().trackSort;
    const direction = get().trackSortDirection;
    const generation = ++pageGenerations.tracks;
    const page = await readTrackPage(null, sort, direction);
    if (
      generation !== pageGenerations.tracks ||
      get().trackSort !== sort ||
      get().trackSortDirection !== direction
    ) return false;
    const items = page.items ?? [];
    set((current) => ({
      tracks: items,
      trackNextCursor: page.nextCursor ?? null,
      trackPrevCursor: null,
      totalTrackCount: page.totalCount ?? 0,
      jumpAnchorIndex: 0,
      ...remountIfShorter(current, current.tracks.length, items.length, forceRemount),
    }));
    return true;
  };

  const resetAlbums = async (forceRemount = false) => {
    const sort = get().albumSort;
    const direction = get().albumSortDirection;
    const includeSingles = useSettingsStore.getState().includeSingles;
    const generation = ++pageGenerations.albums;
    const page = await readAlbumPage(null, sort, direction, includeSingles);
    if (
      generation !== pageGenerations.albums ||
      get().albumSort !== sort ||
      get().albumSortDirection !== direction ||
      useSettingsStore.getState().includeSingles !== includeSingles
    ) return false;
    const items = page.items ?? [];
    set((current) => ({
      albums: items,
      albumNextCursor: page.nextCursor ?? null,
      albumPrevCursor: null,
      jumpAnchorIndex: 0,
      ...remountIfShorter(current, current.albums.length, items.length, forceRemount),
    }));
    return true;
  };

  const resetArtists = async (forceRemount = false) => {
    const sort = get().artistSort;
    const direction = get().artistSortDirection;
    const groupingMode = useSettingsStore.getState().artistGroupingMode;
    const includeCollaborations = get().includeCollabArtists;
    const generation = ++pageGenerations.artists;
    const page = await readArtistPage(
      null,
      sort,
      direction,
      groupingMode,
      includeCollaborations,
    );
    if (
      generation !== pageGenerations.artists ||
      get().artistSort !== sort ||
      get().artistSortDirection !== direction ||
      useSettingsStore.getState().artistGroupingMode !== groupingMode ||
      get().includeCollabArtists !== includeCollaborations
    ) return false;
    const items = page.items ?? [];
    set((current) => ({
      artists: items,
      artistNextCursor: page.nextCursor ?? null,
      artistPrevCursor: null,
      jumpAnchorIndex: 0,
      ...remountIfShorter(current, current.artists.length, items.length, forceRemount),
    }));
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
    const direction =
      state.viewMode === 'tracks'
        ? state.trackSortDirection
        : state.viewMode === 'albums'
          ? state.albumSortDirection
          : state.artistSortDirection;
    const includeSingles = useSettingsStore.getState().includeSingles;
    const groupingMode = useSettingsStore.getState().artistGroupingMode;
    const anchors = await AstraLibraryData.getSectionAnchors(
      state.viewMode as 'tracks' | 'albums' | 'artists',
      sort,
      direction,
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
    const currentDirection =
      current.viewMode === 'tracks'
        ? current.trackSortDirection
        : current.viewMode === 'albums'
          ? current.albumSortDirection
          : current.artistSortDirection;
    if (
      generation !== anchorGeneration ||
      current.viewMode !== state.viewMode ||
      currentSort !== sort ||
      currentDirection !== direction ||
      useSettingsStore.getState().includeSingles !== includeSingles ||
      useSettingsStore.getState().artistGroupingMode !== groupingMode ||
      current.includeCollabArtists !== state.includeCollabArtists
    ) return;
    set({ sectionAnchors: anchors });
  };

  const runScan = async (scan: (cancellation: ScanCancellationSignal) => Promise<ScanResult | null>) => {
    if (get().isScanning) return;
    const cancellation = createScanCancellationController();
    activeScanCancellation = cancellation;
    set({
      isScanning: true,
      isCancelling: false,
      scanError: null,
      scanProgress: { ...IDLE_PROGRESS },
    });
    try {
      await scan(cancellation.signal);
    } catch (error) {
      set({ scanError: error instanceof Error ? error.message : String(error) });
    } finally {
      try {
        await get().refresh();
        // A scan is the user asking Astra to look at their library again, so it
        // also re-opens artist-image lookups that previously found no match.
        // New artists queue on their own; these would never retry otherwise.
        await requeueMissingArtistImages();
      } finally {
        if (activeScanCancellation === cancellation) activeScanCancellation = null;
        set({
          isScanning: false,
          isCancelling: false,
          scanProgress: { ...IDLE_PROGRESS },
        });
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
    trackSortDirection: 'asc',
    albumSortDirection: 'asc',
    artistSortDirection: 'asc',
    albumLayout: DEFAULT_LIBRARY_LAYOUT,
    artistLayout: DEFAULT_LIBRARY_LAYOUT,
    includeCollabArtists: false,
    isScanning: false,
    isCancelling: false,
    scanProgress: { ...IDLE_PROGRESS },
    scanError: null,
    trackNextCursor: null,
    albumNextCursor: null,
    artistNextCursor: null,
    trackPrevCursor: null,
    albumPrevCursor: null,
    artistPrevCursor: null,
    sectionAnchors: [],
    sectionJumpRevision: 0,
    jumpAnchorIndex: 0,

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
            TRACK_SORT_DIRECTION_KEY,
            ALBUM_SORT_DIRECTION_KEY,
            ARTIST_SORT_DIRECTION_KEY,
            ALBUM_LAYOUT_KEY,
            ARTIST_LAYOUT_KEY,
            INCLUDE_COLLAB_ARTISTS_KEY,
          ]);
          const viewMode = parseViewMode(values[VIEW_MODE_KEY] ?? null);
          const trackSort = parseTrackSort(values[TRACK_SORT_KEY] ?? null);
          const albumSort = parseAlbumSort(values[ALBUM_SORT_KEY] ?? null);
          const artistSort = parseArtistSort(values[ARTIST_SORT_KEY] ?? null);
          const restoredTrackSort = trackSort ?? get().trackSort;
          const restoredAlbumSort = albumSort ?? get().albumSort;
          const restoredArtistSort = artistSort ?? get().artistSort;
          const trackSortDirection =
            parseSortDirection(values[TRACK_SORT_DIRECTION_KEY] ?? null) ??
            TRACK_SORT_LEGACY_DIRECTIONS[restoredTrackSort];
          const albumSortDirection =
            parseSortDirection(values[ALBUM_SORT_DIRECTION_KEY] ?? null) ??
            ALBUM_SORT_LEGACY_DIRECTIONS[restoredAlbumSort];
          const artistSortDirection =
            parseSortDirection(values[ARTIST_SORT_DIRECTION_KEY] ?? null) ??
            ARTIST_SORT_LEGACY_DIRECTIONS[restoredArtistSort];
          set({
            ...(viewMode ? { viewMode } : {}),
            ...(trackSort ? { trackSort } : {}),
            ...(albumSort ? { albumSort } : {}),
            ...(artistSort ? { artistSort } : {}),
            trackSortDirection,
            albumSortDirection,
            artistSortDirection,
            albumLayout: parseLibraryLayout(values[ALBUM_LAYOUT_KEY] ?? null),
            artistLayout: parseLibraryLayout(values[ARTIST_LAYOUT_KEY] ?? null),
            includeCollabArtists: values[INCLUDE_COLLAB_ARTISTS_KEY] === 'true',
          });
          // Direction keys were introduced after sort-field persistence. Write
          // the derived legacy direction once so subsequent field changes keep
          // the per-view preference instead of re-deriving it.
          if (!parseSortDirection(values[TRACK_SORT_DIRECTION_KEY] ?? null)) {
            persistSetting(TRACK_SORT_DIRECTION_KEY, trackSortDirection);
          }
          if (!parseSortDirection(values[ALBUM_SORT_DIRECTION_KEY] ?? null)) {
            persistSetting(ALBUM_SORT_DIRECTION_KEY, albumSortDirection);
          }
          if (!parseSortDirection(values[ARTIST_SORT_DIRECTION_KEY] ?? null)) {
            persistSetting(ARTIST_SORT_DIRECTION_KEY, artistSortDirection);
          }

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
            AstraLibraryData.addListener('onArtistImagesChanged', () => {
              if (artistImageRefreshTimer) clearTimeout(artistImageRefreshTimer);
              artistImageRefreshTimer = setTimeout(() => {
                artistImageRefreshTimer = null;
                void get().refresh();
              }, 300);
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
          const needsMetadataReindex = get().folders.some(
            (folder) => folder.available && folder.needs_metadata_reindex === true
          );
          if ((status.status === 'rebuilding' || needsMetadataReindex) && !get().isScanning) {
            // Version gates already select stale rows. Retrying one failed
            // upgrade must not re-read every successfully upgraded file.
            if (status.status === 'rebuilding') void get().rebuildLocalIndex();
            else void get().rescan();
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
      const trackSortDirection = stateAtStart.trackSortDirection;
      const albumSortDirection = stateAtStart.albumSortDirection;
      const artistSortDirection = stateAtStart.artistSortDirection;
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
        viewMode === 'tracks'
          ? readTrackPage(null, trackSort, trackSortDirection)
          : Promise.resolve(null),
        viewMode === 'albums'
          ? readAlbumPage(null, albumSort, albumSortDirection, includeSingles)
          : Promise.resolve(null),
        viewMode === 'artists'
          ? readArtistPage(
              null,
              artistSort,
              artistSortDirection,
              groupingMode,
              includeCollaborations,
            )
          : Promise.resolve(null),
        AstraLibraryData.getAlbumPage<Album>(
          'recently_added',
          'desc',
          includeSingles,
          null,
          20
        ),
        AstraLibraryData.getArtistPage<Artist>(
          'name',
          'asc',
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
        current.trackSortDirection === trackSortDirection &&
        activeGeneration === pageGenerations.tracks;
      const canApplyAlbumPage =
        viewMode === 'albums' &&
        current.viewMode === 'albums' &&
        current.albumSort === albumSort &&
        current.albumSortDirection === albumSortDirection &&
        useSettingsStore.getState().includeSingles === includeSingles &&
        activeGeneration === pageGenerations.albums;
      const canApplyArtistPage =
        viewMode === 'artists' &&
        current.viewMode === 'artists' &&
        current.artistSort === artistSort &&
        current.artistSortDirection === artistSortDirection &&
        useSettingsStore.getState().artistGroupingMode === groupingMode &&
        current.includeCollabArtists === includeCollaborations &&
        activeGeneration === pageGenerations.artists;
      const collapsesWindow =
        (!!trackPage && canApplyTrackPage && current.tracks.length > (trackPage.items?.length ?? 0)) ||
        (!!albumPage && canApplyAlbumPage && current.albums.length > (albumPage.items?.length ?? 0)) ||
        (!!artistPage && canApplyArtistPage && current.artists.length > (artistPage.items?.length ?? 0));
      set({
        ...(trackPage && canApplyTrackPage ? {
          tracks: trackPage.items ?? [],
          trackNextCursor: trackPage.nextCursor ?? null,
          trackPrevCursor: null,
          totalTrackCount: trackPage.totalCount ?? current.totalTrackCount,
        } : {}),
        ...(albumPage && canApplyAlbumPage ? {
          albums: albumPage.items ?? [],
          albumNextCursor: albumPage.nextCursor ?? null,
          albumPrevCursor: null,
        } : {}),
        ...(artistPage && canApplyArtistPage ? {
          artists: artistPage.items ?? [],
          artistNextCursor: artistPage.nextCursor ?? null,
          artistPrevCursor: null,
        } : {}),
        ...(collapsesWindow
          ? { jumpAnchorIndex: 0, sectionJumpRevision: current.sectionJumpRevision + 1 }
          : {}),
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
      if (!cursor || forwardBusy.tracks) return;
      const sort = state.trackSort;
      const direction = state.trackSortDirection;
      const pageGeneration = pageGenerations.tracks;
      forwardBusy.tracks = true;
      try {
        const page = await readTrackPage(cursor, sort, direction);
        if (
          pageGeneration !== pageGenerations.tracks ||
          get().trackSort !== sort ||
          get().trackSortDirection !== direction ||
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
        forwardBusy.tracks = false;
      }
    },

    loadNextAlbums: async () => {
      const state = get();
      const cursor = state.albumNextCursor;
      if (!cursor || forwardBusy.albums) return;
      const sort = state.albumSort;
      const direction = state.albumSortDirection;
      const includeSingles = useSettingsStore.getState().includeSingles;
      const pageGeneration = pageGenerations.albums;
      forwardBusy.albums = true;
      try {
        const page = await readAlbumPage(cursor, sort, direction, includeSingles);
        if (
          pageGeneration !== pageGenerations.albums ||
          get().albumSort !== sort ||
          get().albumSortDirection !== direction ||
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
        forwardBusy.albums = false;
      }
    },

    loadNextArtists: async () => {
      const state = get();
      const cursor = state.artistNextCursor;
      if (!cursor || forwardBusy.artists) return;
      const sort = state.artistSort;
      const direction = state.artistSortDirection;
      const groupingMode = useSettingsStore.getState().artistGroupingMode;
      const includeCollaborations = state.includeCollabArtists;
      const pageGeneration = pageGenerations.artists;
      forwardBusy.artists = true;
      try {
        const page = await readArtistPage(
          cursor,
          sort,
          direction,
          groupingMode,
          includeCollaborations,
        );
        if (
          pageGeneration !== pageGenerations.artists ||
          get().artistSort !== sort ||
          get().artistSortDirection !== direction ||
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
        forwardBusy.artists = false;
      }
    },

    loadPreviousTracks: async () => {
      const state = get();
      const cursor = state.trackPrevCursor;
      const sort = backwardTrackSort(state.trackSort);
      const direction = state.trackSortDirection;
      if (!cursor || !sort || backwardBusy.tracks) return;
      const pageGeneration = pageGenerations.tracks;
      backwardBusy.tracks = true;
      try {
        const page = await readTrackPageBefore(cursor, sort, direction);
        if (
          pageGeneration !== pageGenerations.tracks ||
          get().trackSort !== sort ||
          get().trackSortDirection !== direction ||
          get().trackPrevCursor !== cursor
        ) return;
        if (page.error === 'STALE_REVISION') {
          await resetTracks();
          return;
        }
        set((current) => ({
          tracks: prependWindow(current.tracks, page.items, (track) => track.path),
          trackPrevCursor: page.previousCursor,
        }));
      } finally {
        backwardBusy.tracks = false;
      }
    },

    loadPreviousAlbums: async () => {
      const state = get();
      const cursor = state.albumPrevCursor;
      const sort = backwardAlbumSort(state.albumSort);
      const direction = state.albumSortDirection;
      if (!cursor || !sort || backwardBusy.albums) return;
      const includeSingles = useSettingsStore.getState().includeSingles;
      const pageGeneration = pageGenerations.albums;
      backwardBusy.albums = true;
      try {
        const page = await readAlbumPageBefore(cursor, sort, direction, includeSingles);
        if (
          pageGeneration !== pageGenerations.albums ||
          get().albumSort !== sort ||
          get().albumSortDirection !== direction ||
          useSettingsStore.getState().includeSingles !== includeSingles ||
          get().albumPrevCursor !== cursor
        ) return;
        if (page.error === 'STALE_REVISION') {
          await resetAlbums();
          return;
        }
        set((current) => ({
          albums: prependWindow(current.albums, page.items, (album) => album.identity_key),
          albumPrevCursor: page.previousCursor,
        }));
      } finally {
        backwardBusy.albums = false;
      }
    },

    loadPreviousArtists: async () => {
      const state = get();
      const cursor = state.artistPrevCursor;
      if (!cursor || state.artistSort !== 'name' || backwardBusy.artists) return;
      const direction = state.artistSortDirection;
      const groupingMode = useSettingsStore.getState().artistGroupingMode;
      const includeCollaborations = state.includeCollabArtists;
      const pageGeneration = pageGenerations.artists;
      backwardBusy.artists = true;
      try {
        const page = await readArtistPageBefore(
          cursor,
          direction,
          groupingMode,
          includeCollaborations,
        );
        if (
          pageGeneration !== pageGenerations.artists ||
          get().artistSort !== 'name' ||
          get().artistSortDirection !== direction ||
          useSettingsStore.getState().artistGroupingMode !== groupingMode ||
          get().includeCollabArtists !== includeCollaborations ||
          get().artistPrevCursor !== cursor
        ) return;
        if (page.error === 'STALE_REVISION') {
          await resetArtists();
          return;
        }
        set((current) => ({
          artists: prependWindow(current.artists, page.items, (artist) => artist.artist),
          artistPrevCursor: page.previousCursor,
        }));
      } finally {
        backwardBusy.artists = false;
      }
    },

    // A jump rebuilds the window around the letter: the letter's own page, plus the
    // page immediately above it. Without that page above, the list would remount with
    // the letter as row 0 and there would be nothing to scroll back up into — and
    // `onStartReached` would fire the moment the list mounted at offset 0, cascading
    // backwards to the head of the catalog.
    jumpToSection: async (cursor) => {
      const state = get();
      const viewMode = state.viewMode;
      if (viewMode !== 'tracks' && viewMode !== 'albums' && viewMode !== 'artists') return false;
      const generation = ++pageGenerations[viewMode];
      if (viewMode === 'tracks') {
        const sort = state.trackSort;
        const direction = state.trackSortDirection;
        const backwardSort = backwardTrackSort(sort);
        const [page, before] = await Promise.all([
          readTrackPage(cursor, sort, direction),
          backwardSort
            ? readTrackPageBefore(cursor, backwardSort, direction)
            : Promise.resolve(null),
        ]);
        if (
          generation !== pageGenerations.tracks ||
          get().viewMode !== viewMode ||
          get().trackSort !== sort ||
          get().trackSortDirection !== direction
        ) return false;
        if (page.error === 'STALE_REVISION') {
          await resetTracks();
          return false;
        }
        if (page.items.length === 0) {
          void resetSectionAnchors();
          return false;
        }
        const above = before && !before.error ? before : null;
        set((current) => ({
          tracks: [...(above?.items ?? []), ...page.items],
          trackNextCursor: page.nextCursor,
          trackPrevCursor: above?.previousCursor ?? null,
          totalTrackCount: page.totalCount,
          jumpAnchorIndex: above?.items.length ?? 0,
          sectionJumpRevision: current.sectionJumpRevision + 1,
        }));
      } else if (viewMode === 'albums') {
        const sort = state.albumSort;
        const direction = state.albumSortDirection;
        const includeSingles = useSettingsStore.getState().includeSingles;
        const backwardSort = backwardAlbumSort(sort);
        const [page, before] = await Promise.all([
          readAlbumPage(cursor, sort, direction, includeSingles),
          backwardSort
            ? readAlbumPageBefore(cursor, backwardSort, direction, includeSingles)
            : Promise.resolve(null),
        ]);
        if (
          generation !== pageGenerations.albums ||
          get().viewMode !== viewMode ||
          get().albumSort !== sort ||
          get().albumSortDirection !== direction ||
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
        const above = before && !before.error ? before : null;
        set((current) => ({
          albums: [...(above?.items ?? []), ...page.items],
          albumNextCursor: page.nextCursor,
          albumPrevCursor: above?.previousCursor ?? null,
          jumpAnchorIndex: above?.items.length ?? 0,
          sectionJumpRevision: current.sectionJumpRevision + 1,
        }));
      } else {
        const sort = state.artistSort;
        const direction = state.artistSortDirection;
        const groupingMode = useSettingsStore.getState().artistGroupingMode;
        const includeCollaborations = state.includeCollabArtists;
        const [page, before] = await Promise.all([
          readArtistPage(cursor, sort, direction, groupingMode, includeCollaborations),
          sort === 'name'
            ? readArtistPageBefore(cursor, direction, groupingMode, includeCollaborations)
            : Promise.resolve(null),
        ]);
        if (
          generation !== pageGenerations.artists ||
          get().viewMode !== viewMode ||
          get().artistSort !== sort ||
          get().artistSortDirection !== direction ||
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
        const above = before && !before.error ? before : null;
        set((current) => ({
          artists: [...(above?.items ?? []), ...page.items],
          artistNextCursor: page.nextCursor,
          artistPrevCursor: above?.previousCursor ?? null,
          jumpAnchorIndex: above?.items.length ?? 0,
          sectionJumpRevision: current.sectionJumpRevision + 1,
        }));
      }
      return true;
    },

    /**
     * Rebuilds the current view's window from the head of the catalog and forces
     * the list to remount at row 0.
     *
     * The counterpart to `jumpToSection` — same boolean contract — for getting
     * back to the true top after one. Bumping the page generation also voids any
     * jump still in flight, which would otherwise land after this and undo it.
     */
    rewindToHead: async () => {
      const viewMode = get().viewMode;
      if (viewMode === 'tracks') return resetTracks(true);
      if (viewMode === 'albums') return resetAlbums(true);
      if (viewMode === 'artists') return resetArtists(true);
      return false;
    },

    recordTrackPlayed: async (path) => {
      await AstraLibraryData.recordTrackPlayed(path);
      set({ recentlyPlayedTracks: await AstraLibraryData.getRecentlyPlayed<DbTrack>(20) });
    },

    refreshRecentlyPlayed: async () => {
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
      const current = get();
      const staleTrackWindow = viewMode === 'tracks' && current.trackPrevCursor !== null;
      const staleAlbumWindow = viewMode === 'albums' && current.albumPrevCursor !== null;
      const staleArtistWindow = viewMode === 'artists' && current.artistPrevCursor !== null;
      set({
        viewMode,
        sectionAnchors: [],
        jumpAnchorIndex: 0,
        // Do not briefly present row 0 of a retained A-Z window as the catalog
        // head. The head page below replaces these empty arrays asynchronously.
        ...(staleTrackWindow ? {
          tracks: [],
          trackNextCursor: null,
          trackPrevCursor: null,
        } : {}),
        ...(staleAlbumWindow ? {
          albums: [],
          albumNextCursor: null,
          albumPrevCursor: null,
        } : {}),
        ...(staleArtistWindow ? {
          artists: [],
          artistNextCursor: null,
          artistPrevCursor: null,
        } : {}),
      });
      persistSetting(VIEW_MODE_KEY, viewMode);
      // A-Z windows are useful only while that surface remains active. Returning
      // to a section means its catalog head, never index 0 of a retained
      // mid-catalog window from another visit.
      if (viewMode === 'tracks') {
        if (staleTrackWindow) void resetTracks(true);
        else if (current.tracks.length === 0) void resetTracks();
      }
      if (viewMode === 'albums') {
        if (staleAlbumWindow) void resetAlbums(true);
        else if (current.albums.length === 0) void resetAlbums();
      }
      if (viewMode === 'artists') {
        if (staleArtistWindow) void resetArtists(true);
        else if (current.artists.length === 0) void resetArtists();
      }
      void resetSectionAnchors();
    },

    setTrackSort: (trackSort) => {
      anchorGeneration += 1;
      set({
        trackSort,
        tracks: [],
        trackNextCursor: null,
        trackPrevCursor: null,
        jumpAnchorIndex: 0,
        sectionAnchors: [],
      });
      persistSetting(TRACK_SORT_KEY, trackSort);
      void resetTracks();
      void resetSectionAnchors();
    },

    setAlbumSort: (albumSort) => {
      anchorGeneration += 1;
      set({
        albumSort,
        albums: [],
        albumNextCursor: null,
        albumPrevCursor: null,
        jumpAnchorIndex: 0,
        sectionAnchors: [],
      });
      persistSetting(ALBUM_SORT_KEY, albumSort);
      void resetAlbums();
      void resetSectionAnchors();
    },

    setArtistSort: (artistSort) => {
      anchorGeneration += 1;
      set({
        artistSort,
        artists: [],
        artistNextCursor: null,
        artistPrevCursor: null,
        jumpAnchorIndex: 0,
        sectionAnchors: [],
      });
      persistSetting(ARTIST_SORT_KEY, artistSort);
      void resetArtists();
      void resetSectionAnchors();
    },

    setTrackSortDirection: (trackSortDirection) => {
      if (get().trackSortDirection === trackSortDirection) return;
      anchorGeneration += 1;
      set({
        trackSortDirection,
        tracks: [],
        trackNextCursor: null,
        trackPrevCursor: null,
        jumpAnchorIndex: 0,
        sectionAnchors: [],
      });
      persistSetting(TRACK_SORT_DIRECTION_KEY, trackSortDirection);
      void resetTracks(true);
      void resetSectionAnchors();
    },

    setAlbumSortDirection: (albumSortDirection) => {
      if (get().albumSortDirection === albumSortDirection) return;
      anchorGeneration += 1;
      set({
        albumSortDirection,
        albums: [],
        albumNextCursor: null,
        albumPrevCursor: null,
        jumpAnchorIndex: 0,
        sectionAnchors: [],
      });
      persistSetting(ALBUM_SORT_DIRECTION_KEY, albumSortDirection);
      void resetAlbums(true);
      void resetSectionAnchors();
    },

    setArtistSortDirection: (artistSortDirection) => {
      if (get().artistSortDirection === artistSortDirection) return;
      anchorGeneration += 1;
      set({
        artistSortDirection,
        artists: [],
        artistNextCursor: null,
        artistPrevCursor: null,
        jumpAnchorIndex: 0,
        sectionAnchors: [],
      });
      persistSetting(ARTIST_SORT_DIRECTION_KEY, artistSortDirection);
      void resetArtists(true);
      void resetSectionAnchors();
    },

    setAlbumLayout: (albumLayout) => {
      if (get().albumLayout === albumLayout) return;
      const state = get();
      const needsHeadRewind = state.albumPrevCursor !== null;
      set({
        albumLayout,
        // Keep a genuine A-Z anchor compact until its head page has committed.
        jumpAnchorIndex: needsHeadRewind ? state.jumpAnchorIndex : 0,
      });
      persistSetting(ALBUM_LAYOUT_KEY, albumLayout);
      if (needsHeadRewind) void resetAlbums(true);
    },

    setArtistLayout: (artistLayout) => {
      if (get().artistLayout === artistLayout) return;
      const state = get();
      const needsHeadRewind = state.artistPrevCursor !== null;
      set({
        artistLayout,
        jumpAnchorIndex: needsHeadRewind ? state.jumpAnchorIndex : 0,
      });
      persistSetting(ARTIST_LAYOUT_KEY, artistLayout);
      if (needsHeadRewind) void resetArtists(true);
    },

    setIncludeCollabArtists: (includeCollabArtists) => {
      anchorGeneration += 1;
      set({
        includeCollabArtists,
        artists: [],
        artistNextCursor: null,
        artistPrevCursor: null,
        jumpAnchorIndex: 0,
        sectionAnchors: [],
      });
      persistSetting(INCLUDE_COLLAB_ARTISTS_KEY, includeCollabArtists ? 'true' : 'false');
      void resetArtists();
      void resetSectionAnchors();
    },

    addFolder: () =>
      runScan((cancellation) => addFolderViaPicker({ onProgress }, cancellation)),

    removeFolder: async (folderId) => {
      const folder = get().folders.find((entry) => entry.id === folderId);
      if (!folder) return;
      await scannerRemoveFolder(folder);
      await get().refresh();
    },

    rescan: () =>
      runScan((cancellation) => rescanAll({ callbacks: { onProgress }, cancellation })),

    rebuildLocalIndex: () =>
      runScan((cancellation) =>
        rescanAll({ mode: 'full', callbacks: { onProgress }, cancellation })
      ),

    cancelScan: () => {
      if (!get().isScanning || get().isCancelling || !activeScanCancellation) return;
      set({ isCancelling: true });
      activeScanCancellation.cancel();
      cancelActiveScan();
    },
  };
});

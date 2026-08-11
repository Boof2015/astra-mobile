/* eslint-disable react-hooks/immutability -- Reanimated shared values gate the active UI-thread list. */
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState
} from 'react';
import {
  ActivityIndicator,
  BackHandler,
  View,
  StyleSheet,
  useWindowDimensions
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { type FlashListRef } from '@shopify/flash-list';
import { useFocusEffect, useRouter } from 'expo-router';
import Animated, {
  FadeIn,
  ReduceMotion,
  runOnJS,
  useAnimatedScrollHandler,
  useSharedValue,
} from 'react-native-reanimated';
import { Screen } from '@/components/Screen';
import { ReanimatedFlashList } from '@/components/ReanimatedFlashList';
import {
  ScreenHeader,
  ScreenHeaderAction,
  useScreenHeader,
} from '@/components/ScreenHeader';
import { Text } from '@/components/Text';
import { ViewModeSwitcher } from '@/components/library/ViewModeSwitcher';
import { AlbumGridItem } from '@/components/library/AlbumGridItem';
import { ArtistGridItem } from '@/components/library/ArtistGridItem';
import { AlbumRow } from '@/components/library/AlbumRow';
import { ArtistRow } from '@/components/library/ArtistRow';
import { TrackRow } from '@/components/library/TrackRow';
import { FoldersView } from '@/components/library/FoldersView';
import { LibraryContextBar } from '@/components/library/LibraryContextBar';
import { LibrarySurfaceTransition } from '@/components/library/LibrarySurfaceTransition';
import { MiniPlayerScrim } from '@/components/MiniPlayerScrim';
import { PlaylistsView } from '@/components/library/PlaylistsView';
import { ScanProgress } from '@/components/library/ScanProgress';
import { EmptyLibrary } from '@/components/library/EmptyLibrary';
import { TrackActionsSheet } from '@/components/library/TrackActionsSheet';
import { AlphabetRail } from '@/components/library/AlphabetRail';
import { SelectionActionBar } from '@/components/library/SelectionActionBar';
import {
  AppSheet,
  AppSheetItem,
  AppSheetSection,
  AppSheetTitle,
} from '@/components/sheets/AppSheet';
import { PlaylistPickerSheet } from '@/components/sheets/PlaylistPickerSheet';
import {
  PullSearchGesture,
  PullSearchScrollView,
  useScrollTopGate
} from '@/components/search/PullSearchGesture';
import { spacing } from '@/theme';
import { motion } from '@/theme/motion';
import { useColors } from '@/theme/themed';
import { AppPressable } from '@/components/AppPressable';
import { useShellLayout } from '@/navigation/useShellLayout';
import { useTabReselect } from '@/navigation/useTabReselect';
import { shouldAnimateScrollToTop } from '@/navigation/scrollToTopBehavior';
import type { ScrollToTopHandle } from '@/navigation/scrollToTopHandle';
import { needsWindowRewind } from '@/library/libraryWindowTop';
import {
  flashListInitialAnchor,
  flashListMaintainsVisiblePosition,
  libraryContextBottomClearance,
  libraryContextOverlayHeight,
  libraryContextScrimHeight,
} from '@/library/libraryViewPresentation';
import {
  libraryViewModeLabel,
  type LibraryViewMode,
} from '@/library/libraryViewMode';
import { useMiniPlayerVisible } from '@/playback/useMiniPlayerVisible';
import { useLibraryStore } from '@/stores/libraryStore';
import { usePlayerStore } from '@/stores/playerStore';
import { useSearchStore } from '@/stores/searchStore';
import {
  enqueueEndMany,
  enqueueTopMany,
  playLibraryQuery
} from '@/audio/playbackController';
import { dbTrackToTrack } from '@/library/trackAdapter';
import { playHaptic } from '@/lib/haptics';
import {
  TRACK_SORT_LABELS,
  type TrackSort
} from '@/lib/trackSort';
import {
  ALBUM_SORT_LABELS,
  type AlbumSort
} from '@/lib/albumSort';
import {
  ARTIST_SORT_LABELS,
  type ArtistSort
} from '@/lib/artistSort';
import {
  LIBRARY_LAYOUT_OPTIONS,
  libraryGridColumns,
  libraryLayoutLabel,
  type LibraryLayout,
} from '@/library/libraryLayout';
import type {
  Album,
  Artist,
  DbTrack
} from '@/types/library';

const TRACK_SORT_OPTIONS: TrackSort[] = ['artist', 'title', 'recently_added', 'duration'];
const ALBUM_SORT_OPTIONS: AlbumSort[] = ['artist', 'name', 'recently_added', 'year'];
const ARTIST_SORT_OPTIONS: ArtistSort[] = ['name', 'track_count'];
const CONTEXT_SCRIM_ENTERING = FadeIn
  .duration(motion.quick.duration)
  .reduceMotion(ReduceMotion.System);
/** How long the finger has to settle on a rail letter before the list jumps. */
const JUMP_DEBOUNCE_MS = 100;
/**
 * Screens of runway to keep ahead of the scroll. The old 0.6 was less than a fling
 * covers before a page comes back, so the list hit a wall that looked like the end.
 */
const END_REACHED_THRESHOLD = 2;
const START_REACHED_THRESHOLD = 0.5;
/**
 * The pinned chrome deck, in declared slots.
 *
 * Unlike the other eight screens, Library has controls between its title and its
 * list that must stay reachable, so the collapsing header carries them and the
 * lists must clear them. That total has to be a number we *choose*: the header's
 * height and the lists' top padding both come from it, and a measured value on a
 * screen with `initialScrollIndex` A-Z jumps is the trap that broke the first
 * attempt at this feature.
 *
 * Each slot is enforced with an explicit `height` on the block that fills it, so
 * the declaration is true by construction. They are generous on purpose:
 * `SegmentedControl` has no declared line height of its own, so its natural size
 * is the font's business, and a slot it can grow into beats a number that has to
 * predict it.
 */
const CHROME_SWITCHER_H = 44;
const CHROME_CONTROLS_H = 32;
const CHROME_SCAN_H = 34;
const CHROME_ERROR_H = 34;
const CHROME_GAP = spacing.sm;

function libraryChromeHeight(options: {
  scanning: boolean;
  scanError: boolean;
  controls: boolean;
}): number {
  let height = CHROME_SWITCHER_H;
  if (options.scanning) height += CHROME_GAP + CHROME_SCAN_H;
  if (options.scanError) height += CHROME_GAP + CHROME_ERROR_H;
  if (options.controls) height += CHROME_GAP + CHROME_CONTROLS_H;
  return height;
}

export default function LibraryScreen() {
  const colors = useColors();
  const router = useRouter();
  const viewMode = useLibraryStore((s) => s.viewMode);
  const setViewMode = useLibraryStore((s) => s.setViewMode);
  const albums = useLibraryStore((s) => s.albums);
  const artists = useLibraryStore((s) => s.artists);
  const tracks = useLibraryStore((s) => s.tracks);
  const trackSort = useLibraryStore((s) => s.trackSort);
  const setTrackSort = useLibraryStore((s) => s.setTrackSort);
  const albumSort = useLibraryStore((s) => s.albumSort);
  const setAlbumSort = useLibraryStore((s) => s.setAlbumSort);
  const artistSort = useLibraryStore((s) => s.artistSort);
  const setArtistSort = useLibraryStore((s) => s.setArtistSort);
  const albumLayout = useLibraryStore((s) => s.albumLayout);
  const setAlbumLayout = useLibraryStore((s) => s.setAlbumLayout);
  const artistLayout = useLibraryStore((s) => s.artistLayout);
  const setArtistLayout = useLibraryStore((s) => s.setArtistLayout);
  const loadNextTracks = useLibraryStore((s) => s.loadNextTracks);
  const loadNextAlbums = useLibraryStore((s) => s.loadNextAlbums);
  const loadNextArtists = useLibraryStore((s) => s.loadNextArtists);
  const loadPreviousTracks = useLibraryStore((s) => s.loadPreviousTracks);
  const loadPreviousAlbums = useLibraryStore((s) => s.loadPreviousAlbums);
  const loadPreviousArtists = useLibraryStore((s) => s.loadPreviousArtists);
  const trackNextCursor = useLibraryStore((s) => s.trackNextCursor);
  const albumNextCursor = useLibraryStore((s) => s.albumNextCursor);
  const artistNextCursor = useLibraryStore((s) => s.artistNextCursor);
  const sectionAnchors = useLibraryStore((s) => s.sectionAnchors);
  const sectionJumpRevision = useLibraryStore((s) => s.sectionJumpRevision);
  const jumpAnchorIndex = useLibraryStore((s) => s.jumpAnchorIndex);
  const jumpToSection = useLibraryStore((s) => s.jumpToSection);
  const isScanning = useLibraryStore((s) => s.isScanning);
  const scanError = useLibraryStore((s) => s.scanError);
  const libraryStatus = useLibraryStore((s) => s.status);
  const totalTrackCount = useLibraryStore((s) => s.totalTrackCount);
  const currentPath = usePlayerStore((s) => s.currentTrack?.path);
  const openQuickSearch = useSearchStore((s) => s.openQuickSearch);
  const shell = useShellLayout();
  const phoneContextBar = shell.mode === 'tabs';
  const showScreenTitle = shell.mode !== 'rail';
  const sceneBottomInset = shell.sceneBottomInset;
  const miniPlayerVisible = useMiniPlayerVisible();

  const [actionTrack, setActionTrack] = useState<DbTrack | null>(null);
  const [sortSheetOpen, setSortSheetOpen] = useState(false);
  const [layoutSheetOpen, setLayoutSheetOpen] = useState(false);
  const [viewOptionsSheetOpen, setViewOptionsSheetOpen] = useState(false);
  const [playlistAddMenuOpen, setPlaylistAddMenuOpen] = useState(false);
  const [childSheetOpen, setChildSheetOpen] = useState(false);
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(() => new Set());
  const [playlistPickerOpen, setPlaylistPickerOpen] = useState(false);
  // Measured rather than derived from the window: the grid's width depends on
  // the nav rail, the safe-area insets and the screen gutters, and measuring is
  // one source of truth instead of a copy of all three. 0 until first layout,
  // which `libraryGridColumns` reads as "use the preference".
  const [gridWidth, setGridWidth] = useState(0);
  const scrollTop = useScrollTopGate();
  // The gate object is rebuilt whenever `atTop` flips; these two members are
  // stable, so depending on them keeps the re-tap subscription from churning on
  // every scroll.
  const {
    offsetRef: scrollOffsetRef,
    onScrollOffset: syncScrollOffset,
    setScrollAtTop,
  } = scrollTop;
  const { height: windowHeight } = useWindowDimensions();

  // One ref per view mode so a tab re-tap can send whichever list is on screen
  // back to the top. The `key` prop already remounts these on sort/layout
  // changes; refs re-attach with the new instance on their own.
  const albumListRef = useRef<FlashListRef<Album>>(null);
  const artistListRef = useRef<FlashListRef<Artist>>(null);
  const trackListRef = useRef<FlashListRef<DbTrack>>(null);
  // Callback refs: these two lists are keyed on row types private to their own
  // components, so they hand back the narrow handle instead.
  const playlistListRef = useRef<ScrollToTopHandle | null>(null);
  const folderListRef = useRef<ScrollToTopHandle | null>(null);
  const setPlaylistList = useCallback((list: ScrollToTopHandle | null) => {
    playlistListRef.current = list;
  }, []);
  const setFolderList = useCallback((list: ScrollToTopHandle | null) => {
    folderListRef.current = list;
  }, []);

  const showLibraryStatus =
    totalTrackCount === 0 &&
    !isScanning &&
    (
      libraryStatus === 'empty' ||
      libraryStatus === 'rebuilding' ||
      libraryStatus === 'degraded' ||
      libraryStatus === 'fatalUserData'
    );

  const sortable =
    viewMode === 'tracks' || viewMode === 'albums' || viewMode === 'artists';
  const header = useScreenHeader({
    // In rail mode the rail names the destination, so the header contributes no
    // title and no bar — only the chrome the lists still have to clear.
    hasTitle: showScreenTitle,
    hasBack: false,
    actionCount: !phoneContextBar && showScreenTitle && !showLibraryStatus ? 1 : 0,
    chromeHeight: showLibraryStatus || phoneContextBar
      ? 0
      : libraryChromeHeight({
          scanning: isScanning,
          scanError: Boolean(scanError),
          controls: selectMode || sortable,
        }),
  });
  const resetHeader = header.resetScroll;
  const initialScrollIndex = flashListInitialAnchor(jumpAnchorIndex);
  // A value of `undefined` is not enough here: construct no prop at all at the
  // catalog head so FlashList cannot enqueue an item-0 correction.
  const initialAnchorProps = initialScrollIndex === undefined
    ? {}
    : { initialScrollIndex };
  const maintainVisibleContentPosition = {
    disabled: !flashListMaintainsVisiblePosition(jumpAnchorIndex),
  };
  const contextBottomClearance = libraryContextBottomClearance(
    sceneBottomInset,
    miniPlayerVisible
  );
  const contextOverlayHeight = libraryContextOverlayHeight(contextBottomClearance);
  const listBottomPadding = phoneContextBar
    ? contextOverlayHeight + spacing.lg
    : sceneBottomInset;

  const sortedTracks = viewMode === 'tracks' ? tracks : [];
  const sortedAlbums = viewMode === 'albums' ? albums : [];
  const sortedArtists = viewMode === 'artists' ? artists : [];

  // Tap index is within sortedTracks so the tapped row is the track that plays.
  const playAllFrom = (index: number) => {
    void playLibraryQuery({ kind: 'library', sort: trackSort }, {
      anchorPath: sortedTracks[index]?.path,
      source: { kind: 'library', label: 'Library' },
    });
  };
  const openSearch = () => openQuickSearch();

  // Sits at the end of the loaded window whenever more pages exist, so a fling that
  // outruns the loader stops on a spinner rather than on what looks like the end of
  // the list. Gated on the cursor rather than on an in-flight flag so it does not
  // blink between pages.
  const listFooter = useMemo(
    () => (
      <View style={styles.listFooter}>
        <ActivityIndicator size="small" color={colors.textTertiary} />
      </View>
    ),
    [colors.textTertiary]
  );

  const railVisible = sectionAnchors.length > 1;
  const railLetters = useMemo(
    () => new Set(sectionAnchors.map((entry) => entry.label)),
    [sectionAnchors]
  );

  // A jump refills the window and remounts the list, so firing one per letter crossed
  // made a fast scrub ~27 rebuilds. The bubble and haptic still track every letter
  // (they live in the rail); only the jump itself waits for the finger to settle, and
  // lifting off flushes it immediately.
  const pendingJump = useRef<{ letter: string; timer: ReturnType<typeof setTimeout> } | null>(null);

  const runJump = useCallback((letter: string) => {
    const anchor = useLibraryStore.getState().sectionAnchors.find((entry) => entry.label === letter);
    if (!anchor) return;
    void jumpToSection(anchor.cursor).then((applied) => {
      // A jump usually lands with a page of rows above it, so the list is not at true
      // top and pull-to-search must stay disarmed.
      if (!applied) return;
      const atHead = useLibraryStore.getState().jumpAnchorIndex === 0;
      scrollTop.setScrollAtTop(atHead);
      // A positive anchor is logically mid-catalog and FlashList will position
      // it after mount; its native event deliberately keeps the header compact.
      // Only the first anchor represents the actual head.
      if (atHead) resetHeader();
    });
  }, [jumpToSection, resetHeader, scrollTop]);

  const jumpToLetter = useCallback((letter: string) => {
    if (pendingJump.current) clearTimeout(pendingJump.current.timer);
    pendingJump.current = {
      letter,
      timer: setTimeout(() => {
        pendingJump.current = null;
        runJump(letter);
      }, JUMP_DEBOUNCE_MS),
    };
  }, [runJump]);

  const flushJump = useCallback(() => {
    const pending = pendingJump.current;
    if (!pending) return;
    clearTimeout(pending.timer);
    pendingJump.current = null;
    runJump(pending.letter);
  }, [runJump]);

  useEffect(() => () => {
    if (pendingJump.current) clearTimeout(pendingJump.current.timer);
    pendingJump.current = null;
  }, []);

  // Re-tapping the Library tab while already on the list means "back to the
  // top" — which is also the only offset where pull-to-search arms, so this is
  // the quick way to reach it.
  const scrollToLibraryTop = useCallback(() => {
    // A rail scrub still inside its debounce would otherwise land after this
    // and drop the list straight back down the alphabet.
    if (pendingJump.current) {
      clearTimeout(pendingJump.current.timer);
      pendingJump.current = null;
    }

    const state = useLibraryStore.getState();
    if (!needsWindowRewind(state.viewMode, state)) {
      const list =
        state.viewMode === 'albums'
          ? albumListRef.current
          : state.viewMode === 'artists'
            ? artistListRef.current
            : state.viewMode === 'tracks'
              ? trackListRef.current
              : state.viewMode === 'playlists'
                ? playlistListRef.current
                : folderListRef.current;
      // Null in the empty-library state, where no list is mounted at all.
      list?.scrollToTop({
        animated: shouldAnimateScrollToTop(scrollOffsetRef.current, windowHeight),
      });
      // A programmatic scroll gives the gate no onScroll it can rely on, so arm
      // it directly — the same thing a rail jump (:200), a layout change and a
      // view-mode change already do. The header is deaf to it for the same
      // reason and would stay collapsed over a list already back at row 0.
      setScrollAtTop(true);
      resetHeader();
      return;
    }
    // Rows exist above the loaded window (an A-Z jump put them there), so offset
    // 0 is not the top of the library. Rebuild from page 1 and let the forced
    // remount bring the list back at row 0. Arming the gate only once that
    // resolves matters: doing it up front would let a pull open search while the
    // list is still showing mid-catalog rows at a non-zero offset.
    void useLibraryStore.getState().rewindToHead().then((applied) => {
      if (applied) {
        setScrollAtTop(true);
        resetHeader();
      }
    });
  }, [resetHeader, scrollOffsetRef, setScrollAtTop, windowHeight]);

  useTabReselect('library', scrollToLibraryTop);

  // Multi-select (tracks view): long-press arms it, batch actions live in the
  // bottom bar, selection order follows the current display order.
  const enterSelection = (track: DbTrack) => {
    playHaptic('threshold');
    setSelectMode(true);
    setSelectedIds(new Set([track.id]));
  };

  const toggleSelected = (id: number) => {
    playHaptic('selection');
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const exitSelection = () => {
    setSelectMode(false);
    setSelectedIds(new Set());
    setPlaylistPickerOpen(false);
  };

  const changeViewMode = (mode: LibraryViewMode) => {
    setSortSheetOpen(false);
    setLayoutSheetOpen(false);
    setViewOptionsSheetOpen(false);
    setPlaylistAddMenuOpen(false);
    setChildSheetOpen(false);
    if (selectMode) exitSelection();
    if (mode === viewMode) return;
    // setViewMode clears the shared A-Z anchor. The post-commit effect below
    // resets header + pull-search only after the incoming list is the live one.
    setViewMode(mode);
  };

  // Focus-gated, not a plain effect: the tabs layout keeps this screen mounted
  // while blurred (`detachInactiveScreens={false}` + `freezeOnBlur: false`), so
  // an ungated handler swallowed one back press anywhere in the app — any other
  // tab, any settings screen — whenever selection happened to be active.
  useFocusEffect(
    useCallback(() => {
      if (!selectMode) return undefined;
      const sub = BackHandler.addEventListener('hardwareBackPress', () => {
        exitSelection();
        return true;
      });
      return () => sub.remove();
    }, [selectMode])
  );

  const selectedDbTracks = () => sortedTracks.filter((track) => selectedIds.has(track.id));

  const batchPlayNext = () => {
    const tracks = selectedDbTracks().map(dbTrackToTrack);
    playHaptic('confirm');
    exitSelection();
    void enqueueTopMany(tracks);
  };

  const batchAddToQueue = () => {
    const tracks = selectedDbTracks().map(dbTrackToTrack);
    playHaptic('confirm');
    exitSelection();
    void enqueueEndMany(tracks);
  };

  // One sort trigger + sheet across the three sortable views.
  const sortLabel =
    viewMode === 'tracks'
      ? TRACK_SORT_LABELS[trackSort]
      : viewMode === 'albums'
        ? ALBUM_SORT_LABELS[albumSort]
        : ARTIST_SORT_LABELS[artistSort];
  const sortSheetLabel =
    viewMode === 'tracks' ? 'SORT TRACKS BY' : viewMode === 'albums' ? 'SORT ALBUMS BY' : 'SORT ARTISTS BY';
  const sortItems =
    viewMode === 'tracks'
      ? TRACK_SORT_OPTIONS.map((option) => ({
          key: option,
          label: TRACK_SORT_LABELS[option],
          selected: option === trackSort,
          onSelect: () => setTrackSort(option),
        }))
      : viewMode === 'albums'
        ? ALBUM_SORT_OPTIONS.map((option) => ({
            key: option,
            label: ALBUM_SORT_LABELS[option],
            selected: option === albumSort,
            onSelect: () => setAlbumSort(option),
          }))
        : ARTIST_SORT_OPTIONS.map((option) => ({
            key: option,
            label: ARTIST_SORT_LABELS[option],
            selected: option === artistSort,
            onSelect: () => setArtistSort(option),
          }));
  const activeLayout =
    viewMode === 'albums'
      ? albumLayout
      : viewMode === 'artists'
        ? artistLayout
        : null;
  const activeLayoutLabel = activeLayout ? libraryLayoutLabel(activeLayout) : null;
  const layoutSheetLabel = viewMode === 'albums' ? 'ALBUM LAYOUT' : 'ARTIST LAYOUT';
  // The preference is a tile-size choice, so the count follows the width the
  // grid actually got. Both feed the FlashList `key` as well as `numColumns` —
  // the key already carried the layout because changing column count needs a
  // remount, and a rotation changes the count without changing the preference.
  const albumColumns = libraryGridColumns(albumLayout, gridWidth);
  const artistColumns = libraryGridColumns(artistLayout, gridWidth);

  const surfaceHeadIdentity =
    viewMode === 'albums'
      ? `albums:${albumSort}:${albumLayout}:${albumColumns}`
      : viewMode === 'artists'
        ? `artists:${artistSort}:${artistLayout}:${artistColumns}`
        : viewMode === 'tracks'
          ? `tracks:${trackSort}`
          : viewMode;
  const listMountIdentity = `${surfaceHeadIdentity}:${sectionJumpRevision}`;
  const activeListMountIdentity = useRef(listMountIdentity);
  const settledHeadListIdentity = useRef<string | null>(null);
  const activeListMountIdentityUi = useSharedValue(listMountIdentity);
  const settledHeadListIdentityUi = useSharedValue<string | null>(null);
  useLayoutEffect(() => {
    activeListMountIdentity.current = listMountIdentity;
    activeListMountIdentityUi.value = listMountIdentity;
    // FlashList can report its item-0 correction before `onLoad`. Keep that
    // native bookkeeping event away from the header until the list is moved to
    // its true scroll origin below. Positive A-Z anchors and the two child-list
    // surfaces are already deliberately positioned and need no such gate.
    settledHeadListIdentity.current =
      jumpAnchorIndex > 0 || viewMode === 'playlists' || viewMode === 'folders'
        ? listMountIdentity
        : null;
    settledHeadListIdentityUi.value = settledHeadListIdentity.current;
  }, [
    activeListMountIdentityUi,
    jumpAnchorIndex,
    listMountIdentity,
    settledHeadListIdentityUi,
    viewMode,
  ]);

  useEffect(() => {
    if (jumpAnchorIndex > 0) return;
    setScrollAtTop(true);
    resetHeader();
  }, [
    jumpAnchorIndex,
    resetHeader,
    sectionJumpRevision,
    setScrollAtTop,
    surfaceHeadIdentity,
  ]);

  const setActiveLayout = (layout: LibraryLayout) => {
    if (viewMode === 'albums') setAlbumLayout(layout);
    if (viewMode === 'artists') setArtistLayout(layout);
  };

  const settleActiveFlashListAtHead = useCallback(() => {
    const state = useLibraryStore.getState();
    if (
      activeListMountIdentity.current !== listMountIdentity ||
      state.jumpAnchorIndex > 0 ||
      (state.viewMode !== 'albums' &&
        state.viewMode !== 'artists' &&
        state.viewMode !== 'tracks')
    ) {
      return;
    }
    const list = state.viewMode === 'albums'
      ? albumListRef.current
      : state.viewMode === 'artists'
        ? artistListRef.current
        : trackListRef.current;
    list?.scrollToOffset({ offset: 0, animated: false });
    settledHeadListIdentity.current = listMountIdentity;
    settledHeadListIdentityUi.value = listMountIdentity;
    setScrollAtTop(true);
    resetHeader();
  }, [
    listMountIdentity,
    resetHeader,
    setScrollAtTop,
    settledHeadListIdentityUi,
  ]);

  const syncScrollTopGate = useCallback((y: number) => {
    // A queued runOnJS call can also trail an unmount, so retain the JS-side
    // identity guard even though the animation is independently gated below.
    if (activeListMountIdentity.current !== listMountIdentity) return;
    if (settledHeadListIdentity.current !== listMountIdentity) return;
    syncScrollOffset(y);
  }, [listMountIdentity, syncScrollOffset]);

  // The header follows the list entirely on the UI thread. JS only hears when
  // the pull-to-search top gate changes and when a drag/momentum run settles,
  // keeping the imperative tab-reselect offset current without a bridge call on
  // every frame.
  const headerScrollY = header.scrollY;
  const onListScroll = useAnimatedScrollHandler<{ atTop?: boolean }>({
    onScroll: (event, context) => {
      // Native scroll delivery can trail an unmount. A section, sort, layout,
      // or A-Z remount must not inherit an offset from the surface it replaced.
      if (activeListMountIdentityUi.value !== listMountIdentity) return;
      if (settledHeadListIdentityUi.value !== listMountIdentity) return;

      const y = event.contentOffset.y;
      headerScrollY.value = y;
      const atTop = y <= 2;
      if (context.atTop !== atTop) {
        context.atTop = atTop;
        runOnJS(syncScrollTopGate)(y);
      }
    },
    onEndDrag: (event) => {
      runOnJS(syncScrollTopGate)(event.contentOffset.y);
    },
    onMomentumEnd: (event) => {
      runOnJS(syncScrollTopGate)(event.contentOffset.y);
    },
  });

  const inlineStatus = phoneContextBar && (isScanning || scanError) ? (
    <View style={styles.inlineStatus}>
      {isScanning ? <ScanProgress /> : null}
      {scanError ? (
        <Text variant="caption" color={colors.warning} numberOfLines={2}>
          Scan problem: {scanError}
        </Text>
      ) : null}
    </View>
  ) : null;

  // Wide windows can afford the pinned segmented deck. Phones deliberately
  // leave `chromeHeight` at zero and use the thumb-reachable bar below.
  const chrome = showLibraryStatus || phoneContextBar ? null : (
    <>
      <View
        style={[
          styles.switcher,
          { height: CHROME_SWITCHER_H },
          !showScreenTitle && styles.switcherRow,
        ]}
      >
        {/* Only in rail mode, where the parent is a row. In portrait the
            parent is a column, and `flex: 1` there resolves against the
            height — collapsing the switcher to nothing. */}
        <View style={!showScreenTitle ? styles.switcherFill : undefined}>
          <ViewModeSwitcher
            value={viewMode}
            onChange={changeViewMode}
          />
        </View>
        {/* The rail already names this destination, so in landscape there is no
            title row to carry search and it moves in beside the switcher. */}
        {!showScreenTitle ? (
          <AppPressable feedback="control"
            hitSlop={8}
            style={styles.switcherSearch}
            onPress={() => openQuickSearch()}
            accessibilityRole="button"
            accessibilityLabel="Search library"
          >
            <Ionicons name="search" size={22} color={colors.textSecondary} />
          </AppPressable>
        ) : null}
      </View>

      {isScanning ? (
        <View style={[styles.chromeSlot, { height: CHROME_SCAN_H }]}>
          <ScanProgress />
        </View>
      ) : null}
      {scanError ? (
        <Text
          variant="caption"
          color={colors.warning}
          style={[styles.error, { height: CHROME_ERROR_H }]}
          numberOfLines={2}
        >
          Scan problem: {scanError}
        </Text>
      ) : null}

      {selectMode ? (
        <View style={[styles.selectionHeader, { height: CHROME_CONTROLS_H }]}>
          <Text variant="label">
            {selectedIds.size} selected
          </Text>
          <AppPressable feedback="control"  onPress={exitSelection} hitSlop={8} accessibilityRole="button">
            <Text variant="label" color={colors.accentText}>
              Cancel
            </Text>
          </AppPressable>
        </View>
      ) : sortable ? (
        <View style={[styles.controlsRow, { height: CHROME_CONTROLS_H }]}>
          <AppPressable feedback="control"
            style={styles.sortTrigger}
            onPress={() => setSortSheetOpen(true)}
            accessibilityRole="button"
            accessibilityLabel={`Sort by ${sortLabel}`}
          >
            <Ionicons name="swap-vertical" size={14} color={colors.textSecondary} />
            <Text variant="label">{sortLabel}</Text>
          </AppPressable>
          {activeLayout && activeLayoutLabel ? (
            <AppPressable feedback="control"

              style={styles.layoutTrigger}
              hitSlop={8}
              onPress={() => setLayoutSheetOpen(true)}
              accessibilityRole="button"
              accessibilityLabel={`Change ${viewMode} layout. Current layout: ${activeLayoutLabel}`}
            >
              <Ionicons
                name={activeLayout === 'list' ? 'list-outline' : 'grid-outline'}
                size={18}
                color={colors.textSecondary}
              />
            </AppPressable>
          ) : null}
        </View>
      ) : null}
    </>
  );

  return (
    // The header is an overlay the lists scroll under, so the screen keeps
    // neither the top inset nor the gutter — both move into the lists.
    <Screen padded={false} style={styles.screen}>
      <PullSearchGesture atTop={scrollTop.atTop} onOpen={openSearch}>
        {showLibraryStatus ? (
          <View style={[styles.statusArea, { paddingTop: header.contentPaddingTop }]}>
            <EmptyLibrary />
          </View>
        ) : (
          <>
            <View
              style={styles.listArea}
              // The lists pay the gutter inside their content container now, so
              // the grid's usable width is this box less that declared padding.
              onLayout={(e) =>
                setGridWidth(Math.max(0, e.nativeEvent.layout.width - spacing.lg * 2))
              }
            >
              <LibrarySurfaceTransition mode={viewMode}>
                {viewMode === 'albums' ? (
                <ReanimatedFlashList
                  ref={albumListRef}
                  key={`albums-${albumSort}-${albumLayout}-${albumColumns}-${sectionJumpRevision}`}
                  data={sortedAlbums}
                  numColumns={albumColumns}
                  keyExtractor={(album) => album.identity_key}
                  showsVerticalScrollIndicator={false}
                  overScrollMode="never"
                  maintainVisibleContentPosition={maintainVisibleContentPosition}
                  contentContainerStyle={{
                    paddingTop: header.contentPaddingTop,
                    paddingHorizontal: spacing.lg,
                    paddingBottom: listBottomPadding,
                  }}
                  ListHeaderComponent={inlineStatus ?? undefined}
                  renderScrollComponent={PullSearchScrollView}
                  onScroll={onListScroll}
                  scrollEventThrottle={scrollTop.scrollEventThrottle}
                  {...initialAnchorProps}
                  onLoad={settleActiveFlashListAtHead}
                  onEndReached={() => void loadNextAlbums()}
                  onEndReachedThreshold={END_REACHED_THRESHOLD}
                  onStartReached={() => void loadPreviousAlbums()}
                  onStartReachedThreshold={START_REACHED_THRESHOLD}
                  ListFooterComponent={albumNextCursor ? listFooter : null}
                  renderItem={({ item }) => (
                    albumLayout === 'list' ? (
                      <AlbumRow
                        album={item}
                        onPress={() =>
                          router.push({
                            pathname: '/library/album/[key]',
                            params: { key: item.identity_key },
                          })
                        }
                      />
                    ) : (
                      <View style={styles.gridCell}>
                        <AlbumGridItem
                          album={item}
                          onPress={() =>
                            router.push({
                              pathname: '/library/album/[key]',
                              params: { key: item.identity_key },
                            })
                          }
                        />
                      </View>
                    )
                  )}
                />
                ) : null}

                {viewMode === 'artists' ? (
                <ReanimatedFlashList
                  ref={artistListRef}
                  key={`artists-${artistSort}-${artistLayout}-${artistColumns}-${sectionJumpRevision}`}
                  data={sortedArtists}
                  numColumns={artistColumns}
                  keyExtractor={(artist) => artist.artist}
                  showsVerticalScrollIndicator={false}
                  overScrollMode="never"
                  maintainVisibleContentPosition={maintainVisibleContentPosition}
                  contentContainerStyle={{
                    paddingTop: header.contentPaddingTop,
                    paddingHorizontal: spacing.lg,
                    paddingBottom: listBottomPadding,
                  }}
                  ListHeaderComponent={inlineStatus ?? undefined}
                  renderScrollComponent={PullSearchScrollView}
                  onScroll={onListScroll}
                  scrollEventThrottle={scrollTop.scrollEventThrottle}
                  {...initialAnchorProps}
                  onLoad={settleActiveFlashListAtHead}
                  onEndReached={() => void loadNextArtists()}
                  onEndReachedThreshold={END_REACHED_THRESHOLD}
                  onStartReached={() => void loadPreviousArtists()}
                  onStartReachedThreshold={START_REACHED_THRESHOLD}
                  ListFooterComponent={artistNextCursor ? listFooter : null}
                  renderItem={({ item }) => (
                    artistLayout === 'list' ? (
                      <ArtistRow
                        artist={item}
                        onPress={() =>
                          router.push({
                            pathname: '/library/artist/[name]',
                            params: { name: item.artist },
                          })
                        }
                      />
                    ) : (
                      <View style={styles.gridCell}>
                        <ArtistGridItem
                          artist={item}
                          onPress={() =>
                            router.push({
                              pathname: '/library/artist/[name]',
                              params: { name: item.artist },
                            })
                          }
                        />
                      </View>
                    )
                  )}
                />
                ) : null}

                {viewMode === 'tracks' ? (
                <ReanimatedFlashList
                  ref={trackListRef}
                  key={`tracks-${trackSort}-${sectionJumpRevision}`}
                  data={sortedTracks}
                  keyExtractor={(track) => String(track.id)}
                  showsVerticalScrollIndicator={false}
                  overScrollMode="never"
                  maintainVisibleContentPosition={maintainVisibleContentPosition}
                  contentContainerStyle={{
                    paddingTop: header.contentPaddingTop,
                    paddingHorizontal: spacing.lg,
                    paddingBottom: listBottomPadding,
                  }}
                  ListHeaderComponent={inlineStatus ?? undefined}
                  renderScrollComponent={PullSearchScrollView}
                  onScroll={onListScroll}
                  scrollEventThrottle={scrollTop.scrollEventThrottle}
                  {...initialAnchorProps}
                  onLoad={settleActiveFlashListAtHead}
                  onEndReached={() => void loadNextTracks()}
                  onEndReachedThreshold={END_REACHED_THRESHOLD}
                  onStartReached={() => void loadPreviousTracks()}
                  onStartReachedThreshold={START_REACHED_THRESHOLD}
                  ListFooterComponent={trackNextCursor ? listFooter : null}
                  extraData={selectMode ? selectedIds : undefined}
                  renderItem={({ item, index }) => (
                    <TrackRow
                      track={item}
                      active={item.path === currentPath}
                      onPress={() => playAllFrom(index)}
                      onLongPress={() => enterSelection(item)}
                      onOpenActions={() => setActionTrack(item)}
                      selectionMode={selectMode}
                      selected={selectedIds.has(item.id)}
                      onToggleSelect={() => toggleSelected(item.id)}
                    />
                  )}
                />
                ) : null}

                {viewMode === 'playlists' ? (
                <PlaylistsView
                  listRef={setPlaylistList}
                  onScroll={onListScroll}
                  scrollEventThrottle={scrollTop.scrollEventThrottle}
                  contentPaddingTop={header.contentPaddingTop}
                  contentPaddingBottom={listBottomPadding}
                  listHeader={inlineStatus}
                  addMenuOpen={playlistAddMenuOpen}
                  onCloseAddMenu={() => setPlaylistAddMenuOpen(false)}
                  onSheetOpenChange={setChildSheetOpen}
                />
                ) : null}

                {viewMode === 'folders' ? (
                <FoldersView
                  listRef={setFolderList}
                  onScroll={onListScroll}
                  scrollEventThrottle={scrollTop.scrollEventThrottle}
                  contentPaddingTop={header.contentPaddingTop}
                  contentPaddingBottom={listBottomPadding}
                  listHeader={inlineStatus}
                  onSheetOpenChange={setChildSheetOpen}
                />
                ) : null}

                {railVisible ? (
                // The list area now runs the full height of the screen, behind
                // the header. The rail centres itself in its parent and hangs
                // off its right edge, so it needs a box that matches the part of
                // the list a finger can actually reach.
                <View
                  style={[styles.railArea, { top: header.contentPaddingTop }]}
                  pointerEvents="box-none"
                >
                  <AlphabetRail
                    activeLetters={railLetters}
                    onJumpToLetter={jumpToLetter}
                    onScrubEnd={flushJump}
                  />
                </View>
                ) : null}
              </LibrarySurfaceTransition>
            </View>
          </>
        )}

        <ScreenHeader
          header={header}
          title="Library"
          chrome={chrome}
          actions={
            !phoneContextBar && showScreenTitle && !showLibraryStatus ? (
              <ScreenHeaderAction onPress={() => openQuickSearch()} accessibilityLabel="Search library">
                <Ionicons name="search" size={22} color={colors.textSecondary} />
              </ScreenHeaderAction>
            ) : undefined
          }
        />
      </PullSearchGesture>

      {phoneContextBar && !showLibraryStatus && !(
        actionTrack ||
        playlistPickerOpen ||
        sortSheetOpen ||
        layoutSheetOpen ||
        viewOptionsSheetOpen ||
        playlistAddMenuOpen ||
        childSheetOpen
      ) ? (
        <>
          <Animated.View
            pointerEvents="none"
            entering={CONTEXT_SCRIM_ENTERING}
            style={StyleSheet.absoluteFill}
          >
            <MiniPlayerScrim height={libraryContextScrimHeight(contextBottomClearance)} />
          </Animated.View>
          <LibraryContextBar
            mode={viewMode}
            bottomClearance={contextBottomClearance}
            onChangeMode={changeViewMode}
            onSearch={() => openQuickSearch()}
            contextAction={
              viewMode === 'albums' || viewMode === 'artists'
                ? {
                    icon: 'options-outline',
                    label: `${libraryViewModeLabel(viewMode)} sort and layout options`,
                    onPress: () => setViewOptionsSheetOpen(true),
                  }
                : viewMode === 'tracks'
                  ? {
                      icon: 'swap-vertical',
                      label: `Sort Tracks, currently ${sortLabel}`,
                      onPress: () => setSortSheetOpen(true),
                    }
                  : viewMode === 'playlists'
                    ? {
                        icon: 'add',
                        label: 'Add or import playlist',
                        onPress: () => setPlaylistAddMenuOpen(true),
                      }
                    : undefined
            }
            selection={
              selectMode && viewMode === 'tracks'
                ? {
                    count: selectedIds.size,
                    onPlayNext: batchPlayNext,
                    onAddToQueue: batchAddToQueue,
                    onAddToPlaylist: () => setPlaylistPickerOpen(true),
                    onCancel: exitSelection,
                  }
                : undefined
            }
          />
        </>
      ) : !phoneContextBar && selectMode && viewMode === 'tracks' ? (
        <SelectionActionBar
          count={selectedIds.size}
          onPlayNext={batchPlayNext}
          onAddToQueue={batchAddToQueue}
          onAddToPlaylist={() => setPlaylistPickerOpen(true)}
        />
      ) : null}

      <TrackActionsSheet track={actionTrack} onClose={() => setActionTrack(null)} />
      {playlistPickerOpen ? (
        <PlaylistPickerSheet
          tracks={selectedDbTracks()}
          subtitle={`${selectedIds.size} ${selectedIds.size === 1 ? 'track' : 'tracks'}`}
          onClose={() => setPlaylistPickerOpen(false)}
          onAdded={() => {
            playHaptic('confirm');
            exitSelection();
          }}
        />
      ) : null}
      {sortSheetOpen ? (
        <AppSheet onClose={() => setSortSheetOpen(false)}>
          <AppSheetSection label={sortSheetLabel} />
          {sortItems.map(({ key, label, selected, onSelect }) => (
            <AppSheetItem
              key={key}
              label={label}
              selected={selected}
              onPress={() => {
                onSelect();
                setSortSheetOpen(false);
              }}
            />
          ))}
        </AppSheet>
      ) : null}
      {layoutSheetOpen && activeLayout ? (
        <AppSheet onClose={() => setLayoutSheetOpen(false)}>
          <AppSheetSection label={layoutSheetLabel} />
          {LIBRARY_LAYOUT_OPTIONS.map((option) => (
            <AppSheetItem
              key={option.value}
              label={option.label}
              subtitle={option.subtitle}
              icon={option.icon}
              selected={option.value === activeLayout}
              onPress={() => {
                setActiveLayout(option.value);
                setLayoutSheetOpen(false);
              }}
            />
          ))}
        </AppSheet>
      ) : null}
      {viewOptionsSheetOpen && activeLayout ? (
        <AppSheet scrollable onClose={() => setViewOptionsSheetOpen(false)}>
          <AppSheetTitle title={`${libraryViewModeLabel(viewMode)} options`} />
          <AppSheetSection label={sortSheetLabel} />
          {sortItems.map(({ key, label, selected, onSelect }) => (
            <AppSheetItem
              key={`sort:${key}`}
              label={label}
              selected={selected}
              onPress={onSelect}
            />
          ))}
          <AppSheetSection label={layoutSheetLabel} />
          {LIBRARY_LAYOUT_OPTIONS.map((option) => (
            <AppSheetItem
              key={`layout:${option.value}`}
              label={option.label}
              subtitle={option.subtitle}
              icon={option.icon}
              selected={option.value === activeLayout}
              onPress={() => setActiveLayout(option.value)}
            />
          ))}
        </AppSheet>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  // The header draws behind the status bar; the lists pay the inset instead.
  screen: {
    paddingTop: 0,
  },
  // No list to scroll here, so this one pays the header as plain padding.
  statusArea: {
    flex: 1,
    paddingHorizontal: spacing.lg,
  },
  inlineStatus: {
    paddingTop: spacing.sm,
    paddingBottom: spacing.md,
  },
  // Each chrome block fills the slot `libraryChromeHeight` reserved for it, so
  // the reservation is enforced rather than predicted. Margins are gone: the
  // gaps live in the slot arithmetic now.
  switcher: {
    justifyContent: 'center',
    marginBottom: CHROME_GAP,
  },
  chromeSlot: {
    justifyContent: 'center',
    marginBottom: CHROME_GAP,
  },
  // Rail mode: the switcher shares its row with search, since the title row
  // that used to carry search is gone.
  switcherRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  switcherFill: {
    flex: 1,
    minWidth: 0,
  },
  switcherSearch: {
    flexShrink: 0,
  },
  error: {
    textAlignVertical: 'center',
    marginBottom: CHROME_GAP,
  },
  controlsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: spacing.md,
  },
  sortTrigger: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingVertical: spacing.xs,
  },
  layoutTrigger: {
    padding: spacing.xs,
  },
  // Same vertical rhythm as sortTrigger so entering selection doesn't shift the list.
  selectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  gridCell: {
    flex: 1,
    paddingHorizontal: spacing.xs,
  },
  listArea: {
    flex: 1,
  },
  // Spans the reachable list only, and re-establishes the right gutter the
  // lists now pay inside their content container — the rail overhangs it.
  railArea: {
    position: 'absolute',
    left: 0,
    right: spacing.lg,
    bottom: 0,
  },
  listFooter: {
    paddingVertical: spacing.lg,
    alignItems: 'center',
  },
});

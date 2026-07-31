import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from 'react';
import {
  ActivityIndicator,
  BackHandler,
  View,
  Pressable,
  StyleSheet
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { FlashList } from '@shopify/flash-list';
import { useFocusEffect, useRouter } from 'expo-router';
import { Screen } from '@/components/Screen';
import { Text } from '@/components/Text';
import { ViewModeSwitcher } from '@/components/library/ViewModeSwitcher';
import { AlbumGridItem } from '@/components/library/AlbumGridItem';
import { ArtistGridItem } from '@/components/library/ArtistGridItem';
import { AlbumRow } from '@/components/library/AlbumRow';
import { ArtistRow } from '@/components/library/ArtistRow';
import { TrackRow } from '@/components/library/TrackRow';
import { FoldersView } from '@/components/library/FoldersView';
import { PlaylistsView } from '@/components/library/PlaylistsView';
import { ScanProgress } from '@/components/library/ScanProgress';
import { EmptyLibrary } from '@/components/library/EmptyLibrary';
import { TrackActionsSheet } from '@/components/library/TrackActionsSheet';
import { AlphabetRail } from '@/components/library/AlphabetRail';
import { SelectionActionBar } from '@/components/library/SelectionActionBar';
import {
  AppSheet,
  AppSheetItem,
  AppSheetSection
} from '@/components/sheets/AppSheet';
import { PlaylistPickerSheet } from '@/components/sheets/PlaylistPickerSheet';
import {
  PullSearchGesture,
  PullSearchScrollView,
  useScrollTopGate
} from '@/components/search/PullSearchGesture';
import { spacing } from '@/theme';
import { useColors } from '@/theme/themed';
import { useRipple } from '@/theme/ripple';
import { useShellShowsScreenTitle } from '@/navigation/useShellLayout';
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
  libraryLayoutColumns,
  libraryLayoutLabel,
  type LibraryLayout,
} from '@/library/libraryLayout';
import type {
  DbTrack
} from '@/types/library';

const TRACK_SORT_OPTIONS: TrackSort[] = ['artist', 'title', 'recently_added', 'duration'];
const ALBUM_SORT_OPTIONS: AlbumSort[] = ['artist', 'name', 'recently_added', 'year'];
const ARTIST_SORT_OPTIONS: ArtistSort[] = ['name', 'track_count'];
/** How long the finger has to settle on a rail letter before the list jumps. */
const JUMP_DEBOUNCE_MS = 100;
/**
 * Screens of runway to keep ahead of the scroll. The old 0.6 was less than a fling
 * covers before a page comes back, so the list hit a wall that looked like the end.
 */
const END_REACHED_THRESHOLD = 2;
const START_REACHED_THRESHOLD = 0.5;

export default function LibraryScreen() {
  const colors = useColors();
  const ripple = useRipple();
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
  const showScreenTitle = useShellShowsScreenTitle();

  const [actionTrack, setActionTrack] = useState<DbTrack | null>(null);
  const [sortSheetOpen, setSortSheetOpen] = useState(false);
  const [layoutSheetOpen, setLayoutSheetOpen] = useState(false);
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(() => new Set());
  const [playlistPickerOpen, setPlaylistPickerOpen] = useState(false);
  const scrollTop = useScrollTopGate();

  const showLibraryStatus =
    totalTrackCount === 0 &&
    !isScanning &&
    (
      libraryStatus === 'empty' ||
      libraryStatus === 'rebuilding' ||
      libraryStatus === 'degraded' ||
      libraryStatus === 'fatalUserData'
    );

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
      if (applied) scrollTop.setScrollAtTop(useLibraryStore.getState().jumpAnchorIndex === 0);
    });
  }, [jumpToSection, scrollTop]);

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
  const sortable = viewMode === 'tracks' || viewMode === 'albums' || viewMode === 'artists';
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

  const setActiveLayout = (layout: LibraryLayout) => {
    scrollTop.setScrollAtTop(true);
    if (viewMode === 'albums') setAlbumLayout(layout);
    if (viewMode === 'artists') setArtistLayout(layout);
  };

  return (
    <Screen>
      <PullSearchGesture atTop={scrollTop.atTop} onOpen={openSearch}>
        {/* The rail already names this destination, so in landscape the title
            row is the same word twice for ~80dp of a 411dp-tall window. Search
            moves in beside the switcher; pull-to-search still works either way. */}
        {showScreenTitle ? (
          <View style={styles.headingRow}>
            <Text variant="title" style={styles.heading}>
              Library
            </Text>
            {!showLibraryStatus ? (
              <Pressable android_ripple={ripple.bounded}
                hitSlop={8}
                onPress={() => openQuickSearch()}
                accessibilityRole="button"
                accessibilityLabel="Search library"
              >
                <Ionicons name="search" size={22} color={colors.textSecondary} />
              </Pressable>
            ) : null}
          </View>
        ) : null}

        {showLibraryStatus ? (
          <EmptyLibrary />
        ) : (
          <>
            <View style={[styles.switcher, !showScreenTitle && styles.switcherRow]}>
              {/* Only in rail mode, where the parent is a row. In portrait the
                  parent is a column, and `flex: 1` there resolves against the
                  height — collapsing the switcher to nothing. */}
              <View style={!showScreenTitle ? styles.switcherFill : undefined}>
                <ViewModeSwitcher
                  value={viewMode}
                  onChange={(mode) => {
                    if (selectMode) exitSelection();
                    setLayoutSheetOpen(false);
                    scrollTop.setScrollAtTop(true);
                    setViewMode(mode);
                  }}
                />
              </View>
              {!showScreenTitle ? (
                <Pressable android_ripple={ripple.bounded}
                  hitSlop={8}
                  style={styles.switcherSearch}
                  onPress={() => openQuickSearch()}
                  accessibilityRole="button"
                  accessibilityLabel="Search library"
                >
                  <Ionicons name="search" size={22} color={colors.textSecondary} />
                </Pressable>
              ) : null}
            </View>
            <ScanProgress />
            {scanError ? (
              <Text variant="caption" color={colors.warning} style={styles.error} numberOfLines={2}>
                Scan problem: {scanError}
              </Text>
            ) : null}

            {selectMode ? (
              <View style={styles.selectionHeader}>
                <Text variant="label">
                  {selectedIds.size} selected
                </Text>
                <Pressable android_ripple={ripple.bounded} onPress={exitSelection} hitSlop={8} accessibilityRole="button">
                  <Text variant="label" color={colors.accentText}>
                    Cancel
                  </Text>
                </Pressable>
              </View>
            ) : sortable ? (
              <View style={styles.controlsRow}>
                <Pressable android_ripple={ripple.bounded}
                  style={styles.sortTrigger}
                  onPress={() => setSortSheetOpen(true)}
                  accessibilityRole="button"
                  accessibilityLabel={`Sort by ${sortLabel}`}
                >
                  <Ionicons name="swap-vertical" size={14} color={colors.textSecondary} />
                  <Text variant="label">{sortLabel}</Text>
                </Pressable>
                {activeLayout && activeLayoutLabel ? (
                  <Pressable
                    android_ripple={ripple.bounded}
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
                  </Pressable>
                ) : null}
              </View>
            ) : null}

            <View style={styles.listArea}>
              {viewMode === 'albums' ? (
                <FlashList
                  key={`albums-${albumSort}-${albumLayout}-${sectionJumpRevision}`}
                  data={sortedAlbums}
                  numColumns={libraryLayoutColumns(albumLayout)}
                  keyExtractor={(album) => album.identity_key}
                  showsVerticalScrollIndicator={false}
                  overScrollMode="never"
                  renderScrollComponent={PullSearchScrollView}
                  onScroll={scrollTop.onScroll}
                  scrollEventThrottle={scrollTop.scrollEventThrottle}
                  initialScrollIndex={jumpAnchorIndex}
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
                <FlashList
                  key={`artists-${artistSort}-${artistLayout}-${sectionJumpRevision}`}
                  data={sortedArtists}
                  numColumns={libraryLayoutColumns(artistLayout)}
                  keyExtractor={(artist) => artist.artist}
                  showsVerticalScrollIndicator={false}
                  overScrollMode="never"
                  renderScrollComponent={PullSearchScrollView}
                  onScroll={scrollTop.onScroll}
                  scrollEventThrottle={scrollTop.scrollEventThrottle}
                  initialScrollIndex={jumpAnchorIndex}
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
                <FlashList
                  key={`tracks-${trackSort}-${sectionJumpRevision}`}
                  data={sortedTracks}
                  keyExtractor={(track) => String(track.id)}
                  showsVerticalScrollIndicator={false}
                  overScrollMode="never"
                  renderScrollComponent={PullSearchScrollView}
                  onScroll={scrollTop.onScroll}
                  scrollEventThrottle={scrollTop.scrollEventThrottle}
                  initialScrollIndex={jumpAnchorIndex}
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
                  onScroll={scrollTop.onScroll}
                  scrollEventThrottle={scrollTop.scrollEventThrottle}
                />
              ) : null}

              {viewMode === 'folders' ? (
                <FoldersView
                  onScroll={scrollTop.onScroll}
                  scrollEventThrottle={scrollTop.scrollEventThrottle}
                />
              ) : null}

              {railVisible ? (
                <AlphabetRail
                  activeLetters={railLetters}
                  onJumpToLetter={jumpToLetter}
                  onScrubEnd={flushJump}
                />
              ) : null}
            </View>
          </>
        )}
      </PullSearchGesture>

      {selectMode && viewMode === 'tracks' ? (
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
    </Screen>
  );
}

const styles = StyleSheet.create({
  headingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: spacing.xl,
    marginBottom: spacing.lg,
  },
  heading: {
    flex: 1,
  },
  switcher: {
    marginBottom: spacing.md,
  },
  // Rail mode: the switcher shares its row with search, since the title row
  // that used to carry search is gone.
  switcherRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginTop: spacing.sm,
  },
  switcherFill: {
    flex: 1,
    minWidth: 0,
  },
  switcherSearch: {
    flexShrink: 0,
  },
  error: {
    marginBottom: spacing.md,
  },
  controlsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: spacing.md,
    marginBottom: spacing.xs,
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
    paddingVertical: spacing.xs,
    marginBottom: spacing.xs,
  },
  gridCell: {
    flex: 1,
    paddingHorizontal: spacing.xs,
  },
  listArea: {
    flex: 1,
  },
  listFooter: {
    paddingVertical: spacing.lg,
    alignItems: 'center',
  },
});

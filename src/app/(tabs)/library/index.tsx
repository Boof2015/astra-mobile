import {
  useEffect,
  useMemo,
  useRef,
  useState
} from 'react';
import {
  BackHandler,
  View,
  Pressable,
  StyleSheet
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { FlashList, type FlashListRef } from '@shopify/flash-list';
import { useRouter } from 'expo-router';
import { Screen } from '@/components/Screen';
import { Text } from '@/components/Text';
import { ViewModeSwitcher } from '@/components/library/ViewModeSwitcher';
import { AlbumGridItem } from '@/components/library/AlbumGridItem';
import { ArtistGridItem } from '@/components/library/ArtistGridItem';
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
import { colors, spacing } from '@/theme';
import { useLibraryStore } from '@/stores/libraryStore';
import { usePlayerStore } from '@/stores/playerStore';
import { useSearchStore } from '@/stores/searchStore';
import {
  enqueueEndMany,
  enqueueTopMany,
  playTracks
} from '@/audio/playbackController';
import { dbTrackToTrack } from '@/library/trackAdapter';
import { commitHaptic, dragArmHaptic } from '@/lib/haptics';
import {
  sortTracks,
  TRACK_SORT_LABELS,
  type TrackSort
} from '@/lib/trackSort';
import {
  sortAlbums,
  ALBUM_SORT_LABELS,
  type AlbumSort
} from '@/lib/albumSort';
import {
  sortArtists,
  ARTIST_SORT_LABELS,
  type ArtistSort
} from '@/lib/artistSort';
import { buildLetterIndex, resolveJumpIndex } from '@/lib/letterIndex';
import type {
  Album,
  Artist,
  DbTrack
} from '@/types/library';

const TRACK_SORT_OPTIONS: TrackSort[] = ['artist', 'title', 'recently_added', 'duration'];
const ALBUM_SORT_OPTIONS: AlbumSort[] = ['artist', 'name', 'recently_added', 'year'];
const ARTIST_SORT_OPTIONS: ArtistSort[] = ['name', 'track_count'];

export default function LibraryScreen() {
  const router = useRouter();
  const viewMode = useLibraryStore((s) => s.viewMode);
  const setViewMode = useLibraryStore((s) => s.setViewMode);
  const albums = useLibraryStore((s) => s.albums);
  const artists = useLibraryStore((s) => s.artists);
  const tracks = useLibraryStore((s) => s.tracks);
  const folders = useLibraryStore((s) => s.folders);
  const trackSort = useLibraryStore((s) => s.trackSort);
  const setTrackSort = useLibraryStore((s) => s.setTrackSort);
  const albumSort = useLibraryStore((s) => s.albumSort);
  const setAlbumSort = useLibraryStore((s) => s.setAlbumSort);
  const artistSort = useLibraryStore((s) => s.artistSort);
  const setArtistSort = useLibraryStore((s) => s.setArtistSort);
  const isScanning = useLibraryStore((s) => s.isScanning);
  const scanError = useLibraryStore((s) => s.scanError);
  const currentPath = usePlayerStore((s) => s.currentTrack?.path);
  const openQuickSearch = useSearchStore((s) => s.openQuickSearch);

  const [actionTrack, setActionTrack] = useState<DbTrack | null>(null);
  const [sortSheetOpen, setSortSheetOpen] = useState(false);
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(() => new Set());
  const [playlistPickerOpen, setPlaylistPickerOpen] = useState(false);
  const scrollTop = useScrollTopGate();

  const tracksListRef = useRef<FlashListRef<DbTrack>>(null);
  const albumsListRef = useRef<FlashListRef<Album>>(null);
  const artistsListRef = useRef<FlashListRef<Artist>>(null);

  const isEmpty = tracks.length === 0 && folders.length === 0 && !isScanning;

  const sortedTracks = useMemo(
    () => (viewMode === 'tracks' ? sortTracks(tracks, trackSort) : []),
    [trackSort, tracks, viewMode]
  );
  const sortedAlbums = useMemo(
    () => (viewMode === 'albums' ? sortAlbums(albums, albumSort) : []),
    [albumSort, albums, viewMode]
  );
  const sortedArtists = useMemo(
    () => (viewMode === 'artists' ? sortArtists(artists, artistSort) : []),
    [artistSort, artists, viewMode]
  );

  // Tap index is within sortedTracks so the tapped row is the track that plays.
  const playAllFrom = (index: number) => {
    void playTracks(sortedTracks.map(dbTrackToTrack), index);
  };
  const openSearch = () => openQuickSearch();

  // A-Z rail: only for sorts where a letter jump is meaningful.
  const letterIndex = useMemo(() => {
    if (viewMode === 'tracks' && (trackSort === 'artist' || trackSort === 'title')) {
      return buildLetterIndex(sortedTracks, (t) => (trackSort === 'title' ? t.title : t.artist));
    }
    if (viewMode === 'albums' && (albumSort === 'artist' || albumSort === 'name')) {
      return buildLetterIndex(sortedAlbums, (a) => (albumSort === 'name' ? a.album : a.artist));
    }
    if (viewMode === 'artists' && artistSort === 'name') {
      return buildLetterIndex(sortedArtists, (a) => a.artist);
    }
    return [];
  }, [albumSort, artistSort, sortedAlbums, sortedArtists, sortedTracks, trackSort, viewMode]);

  const railVisible = letterIndex.length > 1;
  const railLetters = useMemo(
    () => new Set(letterIndex.map((entry) => entry.letter)),
    [letterIndex]
  );

  const jumpToLetter = (letter: string) => {
    const index = resolveJumpIndex(letterIndex, letter);
    if (index == null) return;
    // Fire-and-forget: letter-change granularity already throttles the calls.
    if (viewMode === 'tracks') void tracksListRef.current?.scrollToIndex({ index, animated: false });
    else if (viewMode === 'albums') void albumsListRef.current?.scrollToIndex({ index, animated: false });
    else if (viewMode === 'artists') void artistsListRef.current?.scrollToIndex({ index, animated: false });
  };

  // Multi-select (tracks view): long-press arms it, batch actions live in the
  // bottom bar, selection order follows the current display order.
  const enterSelection = (track: DbTrack) => {
    dragArmHaptic();
    setSelectMode(true);
    setSelectedIds(new Set([track.id]));
  };

  const toggleSelected = (id: number) => {
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

  useEffect(() => {
    if (!selectMode) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      exitSelection();
      return true;
    });
    return () => sub.remove();
  }, [selectMode]);

  const selectedDbTracks = () => sortedTracks.filter((track) => selectedIds.has(track.id));

  const batchPlayNext = () => {
    const tracks = selectedDbTracks().map(dbTrackToTrack);
    commitHaptic();
    exitSelection();
    void enqueueTopMany(tracks);
  };

  const batchAddToQueue = () => {
    const tracks = selectedDbTracks().map(dbTrackToTrack);
    commitHaptic();
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

  return (
    <Screen>
      <PullSearchGesture atTop={scrollTop.atTop} onOpen={openSearch}>
        <View style={styles.headingRow}>
          <Text variant="title" style={styles.heading}>
            Library
          </Text>
          {!isEmpty ? (
            <Pressable
              hitSlop={8}
              onPress={() => openQuickSearch()}
              accessibilityRole="button"
              accessibilityLabel="Search library"
            >
              <Ionicons name="search" size={22} color={colors.textSecondary} />
            </Pressable>
          ) : null}
        </View>

        {isEmpty ? (
          <EmptyLibrary />
        ) : (
          <>
            <View style={styles.switcher}>
              <ViewModeSwitcher
                value={viewMode}
                onChange={(mode) => {
                  if (selectMode) exitSelection();
                  scrollTop.setScrollAtTop(true);
                  setViewMode(mode);
                }}
              />
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
                <Pressable onPress={exitSelection} hitSlop={8} accessibilityRole="button">
                  <Text variant="label" color={colors.accentText}>
                    Cancel
                  </Text>
                </Pressable>
              </View>
            ) : sortable ? (
              <Pressable
                style={styles.sortTrigger}
                onPress={() => setSortSheetOpen(true)}
                accessibilityRole="button"
                accessibilityLabel={`Sort by ${sortLabel}`}
              >
                <Ionicons name="swap-vertical" size={14} color={colors.textSecondary} />
                <Text variant="label">{sortLabel}</Text>
              </Pressable>
            ) : null}

            <View style={styles.listArea}>
              {viewMode === 'albums' ? (
                <FlashList
                  ref={albumsListRef}
                  data={sortedAlbums}
                  numColumns={3}
                  keyExtractor={(album) => album.identity_key}
                  showsVerticalScrollIndicator={false}
                  overScrollMode="never"
                  renderScrollComponent={PullSearchScrollView}
                  onScroll={scrollTop.onScroll}
                  scrollEventThrottle={scrollTop.scrollEventThrottle}
                  renderItem={({ item }) => (
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
                  )}
                />
              ) : null}

              {viewMode === 'artists' ? (
                <FlashList
                  ref={artistsListRef}
                  data={sortedArtists}
                  numColumns={3}
                  keyExtractor={(artist) => artist.artist}
                  showsVerticalScrollIndicator={false}
                  overScrollMode="never"
                  renderScrollComponent={PullSearchScrollView}
                  onScroll={scrollTop.onScroll}
                  scrollEventThrottle={scrollTop.scrollEventThrottle}
                  renderItem={({ item }) => (
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
                  )}
                />
              ) : null}

              {viewMode === 'tracks' ? (
                <FlashList
                  ref={tracksListRef}
                  data={sortedTracks}
                  keyExtractor={(track) => String(track.id)}
                  showsVerticalScrollIndicator={false}
                  overScrollMode="never"
                  renderScrollComponent={PullSearchScrollView}
                  onScroll={scrollTop.onScroll}
                  scrollEventThrottle={scrollTop.scrollEventThrottle}
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
                <AlphabetRail activeLetters={railLetters} onJumpToLetter={jumpToLetter} />
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
            commitHaptic();
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
  error: {
    marginBottom: spacing.md,
  },
  sortTrigger: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    alignSelf: 'flex-end',
    paddingVertical: spacing.xs,
    marginBottom: spacing.xs,
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
});

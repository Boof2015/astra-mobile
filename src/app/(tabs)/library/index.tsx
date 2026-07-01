import { useMemo, useState } from 'react';
import { View, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { FlashList } from '@shopify/flash-list';
import { useRouter } from 'expo-router';
import { Screen } from '@/components/Screen';
import { Text } from '@/components/Text';
import { ViewModeSwitcher } from '@/components/library/ViewModeSwitcher';
import { AlbumGridItem } from '@/components/library/AlbumGridItem';
import { TrackRow } from '@/components/library/TrackRow';
import { ArtistRow } from '@/components/library/ArtistRow';
import { FoldersView } from '@/components/library/FoldersView';
import { PlaylistsView } from '@/components/library/PlaylistsView';
import { ScanProgress } from '@/components/library/ScanProgress';
import { EmptyLibrary } from '@/components/library/EmptyLibrary';
import { TrackActionsSheet } from '@/components/library/TrackActionsSheet';
import { ActionSheet } from '@/components/sheets/ActionSheet';
import {
  PullSearchGesture,
  PullSearchScrollView,
  useScrollTopGate,
} from '@/components/search/PullSearchGesture';
import { colors, spacing } from '@/theme';
import { useLibraryStore } from '@/stores/libraryStore';
import { usePlayerStore } from '@/stores/playerStore';
import { useSearchStore } from '@/stores/searchStore';
import { playTracks } from '@/audio/playbackController';
import { dbTrackToTrack } from '@/library/trackAdapter';
import { sortTracks, TRACK_SORT_LABELS, type TrackSort } from '@/lib/trackSort';
import type { DbTrack } from '@/types/library';

const SORT_OPTIONS: TrackSort[] = ['artist', 'title', 'recently_added', 'duration'];

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
  const isScanning = useLibraryStore((s) => s.isScanning);
  const scanError = useLibraryStore((s) => s.scanError);
  const currentPath = usePlayerStore((s) => s.currentTrack?.path);
  const openQuickSearch = useSearchStore((s) => s.openQuickSearch);

  const [actionTrack, setActionTrack] = useState<DbTrack | null>(null);
  const [sortSheetOpen, setSortSheetOpen] = useState(false);
  const scrollTop = useScrollTopGate();

  const isEmpty = tracks.length === 0 && folders.length === 0 && !isScanning;

  const sortedTracks = useMemo(
    () => (viewMode === 'tracks' ? sortTracks(tracks, trackSort) : []),
    [trackSort, tracks, viewMode]
  );

  // Tap index is within sortedTracks so the tapped row is the track that plays.
  const playAllFrom = (index: number) => {
    void playTracks(sortedTracks.map(dbTrackToTrack), index);
  };
  const openSearch = () => openQuickSearch();

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

            {viewMode === 'albums' ? (
              <FlashList
                data={albums}
                numColumns={2}
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
                data={artists}
                keyExtractor={(artist) => artist.artist}
                showsVerticalScrollIndicator={false}
                overScrollMode="never"
                renderScrollComponent={PullSearchScrollView}
                onScroll={scrollTop.onScroll}
                scrollEventThrottle={scrollTop.scrollEventThrottle}
                renderItem={({ item }) => (
                  <ArtistRow
                    artist={item}
                    onPress={() =>
                      router.push({
                        pathname: '/library/artist/[name]',
                        params: { name: item.artist },
                      })
                    }
                  />
                )}
              />
            ) : null}

            {viewMode === 'tracks' ? (
              <>
                <Pressable
                  style={styles.sortTrigger}
                  onPress={() => setSortSheetOpen(true)}
                  accessibilityRole="button"
                >
                  <Ionicons name="swap-vertical" size={14} color={colors.textSecondary} />
                  <Text variant="label">{TRACK_SORT_LABELS[trackSort]}</Text>
                </Pressable>
                <FlashList
                  data={sortedTracks}
                  keyExtractor={(track) => String(track.id)}
                  showsVerticalScrollIndicator={false}
                  overScrollMode="never"
                  renderScrollComponent={PullSearchScrollView}
                  onScroll={scrollTop.onScroll}
                  scrollEventThrottle={scrollTop.scrollEventThrottle}
                  renderItem={({ item, index }) => (
                    <TrackRow
                      track={item}
                      active={item.path === currentPath}
                      onPress={() => playAllFrom(index)}
                      onLongPress={() => setActionTrack(item)}
                    />
                  )}
                />
              </>
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
          </>
        )}
      </PullSearchGesture>

      <TrackActionsSheet track={actionTrack} onClose={() => setActionTrack(null)} />
      <ActionSheet
        visible={sortSheetOpen}
        title="Sort tracks by"
        items={SORT_OPTIONS.map((option) => ({
          key: option,
          label: TRACK_SORT_LABELS[option],
          selected: option === trackSort,
          onPress: () => {
            setTrackSort(option);
            setSortSheetOpen(false);
          },
        }))}
        onClose={() => setSortSheetOpen(false)}
      />
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
  gridCell: {
    flex: 1,
    paddingHorizontal: spacing.xs,
  },
});

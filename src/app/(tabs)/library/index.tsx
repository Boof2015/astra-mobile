import { View, StyleSheet } from 'react-native';
import { FlashList } from '@shopify/flash-list';
import { useRouter } from 'expo-router';
import { Screen } from '@/components/Screen';
import { Text } from '@/components/Text';
import { ViewModeSwitcher } from '@/components/library/ViewModeSwitcher';
import { AlbumGridItem } from '@/components/library/AlbumGridItem';
import { TrackRow } from '@/components/library/TrackRow';
import { ArtistRow } from '@/components/library/ArtistRow';
import { FoldersView } from '@/components/library/FoldersView';
import { ScanProgress } from '@/components/library/ScanProgress';
import { EmptyLibrary } from '@/components/library/EmptyLibrary';
import { colors, spacing } from '@/theme';
import { useLibraryStore } from '@/stores/libraryStore';
import { usePlayerStore } from '@/stores/playerStore';
import { playTracks } from '@/audio/playbackController';
import { dbTrackToTrack } from '@/library/trackAdapter';

export default function LibraryScreen() {
  const router = useRouter();
  const viewMode = useLibraryStore((s) => s.viewMode);
  const setViewMode = useLibraryStore((s) => s.setViewMode);
  const albums = useLibraryStore((s) => s.albums);
  const artists = useLibraryStore((s) => s.artists);
  const tracks = useLibraryStore((s) => s.tracks);
  const folders = useLibraryStore((s) => s.folders);
  const isScanning = useLibraryStore((s) => s.isScanning);
  const scanError = useLibraryStore((s) => s.scanError);
  const currentPath = usePlayerStore((s) => s.currentTrack?.path);

  const isEmpty = tracks.length === 0 && folders.length === 0 && !isScanning;

  const playAllFrom = (index: number) => {
    void playTracks(tracks.map(dbTrackToTrack), index);
  };

  return (
    <Screen>
      <Text variant="title" style={styles.heading}>
        Library
      </Text>

      {isEmpty ? (
        <EmptyLibrary />
      ) : (
        <>
          <View style={styles.switcher}>
            <ViewModeSwitcher value={viewMode} onChange={setViewMode} />
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
            <FlashList
              data={tracks}
              keyExtractor={(track) => String(track.id)}
              showsVerticalScrollIndicator={false}
              renderItem={({ item, index }) => (
                <TrackRow
                  track={item}
                  active={item.path === currentPath}
                  onPress={() => playAllFrom(index)}
                />
              )}
            />
          ) : null}

          {viewMode === 'folders' ? <FoldersView /> : null}
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  heading: {
    marginTop: spacing.xl,
    marginBottom: spacing.lg,
  },
  switcher: {
    marginBottom: spacing.md,
  },
  error: {
    marginBottom: spacing.md,
  },
  gridCell: {
    flex: 1,
    paddingHorizontal: spacing.xs,
  },
});

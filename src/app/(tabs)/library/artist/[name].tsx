import { useMemo } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { FlashList } from '@shopify/flash-list';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Screen } from '@/components/Screen';
import { Text } from '@/components/Text';
import { TrackRow } from '@/components/library/TrackRow';
import { colors, radius, spacing } from '@/theme';
import { useLibraryStore } from '@/stores/libraryStore';
import { usePlayerStore } from '@/stores/playerStore';
import { playTracks } from '@/audio/playbackController';
import { dbTrackToTrack } from '@/library/trackAdapter';

export default function ArtistScreen() {
  const router = useRouter();
  const { name } = useLocalSearchParams<{ name: string }>();
  const allTracks = useLibraryStore((s) => s.tracks);
  const currentPath = usePlayerStore((s) => s.currentTrack?.path);

  // Store tracks are ordered artist/album/disc/track, so the filtered slice
  // keeps album grouping and track order.
  const tracks = useMemo(
    () => allTracks.filter((track) => track.artist === name),
    [allTracks, name]
  );

  const playFrom = (index: number) => {
    void playTracks(tracks.map(dbTrackToTrack), index);
  };

  return (
    <Screen>
      <Pressable style={styles.back} onPress={() => router.back()} hitSlop={8}>
        <Ionicons name="chevron-back" size={22} color={colors.textSecondary} />
        <Text variant="body" color={colors.textSecondary}>
          Library
        </Text>
      </Pressable>

      <View style={styles.header}>
        <View style={styles.headerMeta}>
          <Text variant="heading" numberOfLines={2}>
            {name}
          </Text>
          <Text variant="label">
            {tracks.length} {tracks.length === 1 ? 'track' : 'tracks'}
          </Text>
        </View>
        <Pressable style={styles.playButton} onPress={() => playFrom(0)} accessibilityRole="button">
          <Ionicons name="play" size={16} color={colors.bgPrimary} />
          <Text variant="body" style={styles.playLabel}>
            Play
          </Text>
        </Pressable>
      </View>

      <FlashList
        data={tracks}
        keyExtractor={(track) => String(track.id)}
        showsVerticalScrollIndicator={false}
        renderItem={({ item, index }) => (
          <TrackRow
            track={item}
            active={item.path === currentPath}
            onPress={() => playFrom(index)}
          />
        )}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  back: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    marginTop: spacing.md,
    marginBottom: spacing.md,
    alignSelf: 'flex-start',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.lg,
    gap: spacing.lg,
  },
  headerMeta: {
    flex: 1,
    gap: spacing.xs,
  },
  playButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    backgroundColor: colors.accent,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  playLabel: {
    color: colors.bgPrimary,
    fontWeight: '600',
  },
});

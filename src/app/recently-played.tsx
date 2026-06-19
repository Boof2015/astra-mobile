import { Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { FlashList } from '@shopify/flash-list';
import { useRouter } from 'expo-router';
import { Screen } from '@/components/Screen';
import { Text } from '@/components/Text';
import { TrackRow } from '@/components/library/TrackRow';
import { colors, spacing } from '@/theme';
import { useLibraryStore } from '@/stores/libraryStore';
import { usePlayerStore } from '@/stores/playerStore';
import { playTracks } from '@/audio/playbackController';
import { dbTrackToTrack } from '@/library/trackAdapter';

function formatCount(count: number, noun: string): string {
  return `${count} ${count === 1 ? noun : `${noun}s`}`;
}

function EmptyList() {
  return (
    <View style={styles.emptyState}>
      <Ionicons name="time-outline" size={24} color={colors.textTertiary} />
      <Text variant="body" color={colors.textSecondary} style={styles.emptyText}>
        No recent plays yet.
      </Text>
    </View>
  );
}

export default function RecentlyPlayedScreen() {
  const router = useRouter();
  const tracks = useLibraryStore((s) => s.recentlyPlayedTracks);
  const currentPath = usePlayerStore((s) => s.currentTrack?.path);

  const playFrom = (index: number) => {
    if (tracks.length === 0) return;
    void playTracks(tracks.map(dbTrackToTrack), index);
  };

  return (
    <Screen>
      <Pressable style={styles.back} onPress={() => router.back()} hitSlop={8}>
        <Ionicons name="chevron-back" size={22} color={colors.textSecondary} />
        <Text variant="body" color={colors.textSecondary}>
          Home
        </Text>
      </Pressable>

      <View style={styles.heading}>
        <Text variant="title" numberOfLines={1}>
          Recently Played
        </Text>
        <Text variant="label">{formatCount(tracks.length, 'track')}</Text>
      </View>

      <FlashList
        data={tracks}
        keyExtractor={(track) => track.path}
        showsVerticalScrollIndicator={false}
        renderItem={({ item, index }) => (
          <TrackRow
            track={item}
            active={item.path === currentPath}
            swipeToQueue={false}
            onPress={() => playFrom(index)}
          />
        )}
        ListEmptyComponent={<EmptyList />}
        contentContainerStyle={styles.listContent}
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
    marginBottom: spacing.lg,
    alignSelf: 'flex-start',
  },
  heading: {
    gap: spacing.xs,
    marginBottom: spacing.lg,
  },
  listContent: {
    paddingBottom: spacing.xxl,
  },
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.xxl,
  },
  emptyText: {
    textAlign: 'center',
  },
});

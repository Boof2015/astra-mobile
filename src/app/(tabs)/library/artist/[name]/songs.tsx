import { useMemo, useState } from 'react';
import {
  Pressable,
  StyleSheet,
  View
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { FlashList } from '@shopify/flash-list';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Screen } from '@/components/Screen';
import { Text } from '@/components/Text';
import { TrackRow } from '@/components/library/TrackRow';
import { TrackActionsSheet } from '@/components/library/TrackActionsSheet';
import { spacing } from '@/theme';
import { useColors } from '@/theme/themed';
import { useLibraryStore } from '@/stores/libraryStore';
import { usePlayerStore } from '@/stores/playerStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { playTracks } from '@/audio/playbackController';
import { dbTrackToTrack } from '@/library/trackAdapter';
import { buildArtistDetail } from '@/library/artistDetail';
import type { DbTrack } from '@/types/library';

export default function ArtistSongsScreen() {
  const colors = useColors();
  const router = useRouter();
  const { name = 'Artist' } = useLocalSearchParams<{ name: string }>();
  const allTracks = useLibraryStore((s) => s.tracks);
  const groupingMode = useSettingsStore((s) => s.artistGroupingMode);
  const currentPath = usePlayerStore((s) => s.currentTrack?.path);
  const [actionTrack, setActionTrack] = useState<DbTrack | null>(null);

  const detail = useMemo(
    () => buildArtistDetail(allTracks, name, groupingMode),
    [allTracks, name, groupingMode]
  );
  const tracks = detail.songTracks;

  const playFrom = (index: number) => {
    if (tracks.length === 0) return;
    void playTracks(tracks.map(dbTrackToTrack), index);
  };

  return (
    <Screen>
      <Pressable style={styles.back} onPress={() => router.back()} hitSlop={8}>
        <Ionicons name="chevron-back" size={22} color={colors.textSecondary} />
        <Text variant="body" color={colors.textSecondary} numberOfLines={1}>
          {name}
        </Text>
      </Pressable>

      <View style={styles.heading}>
        <Text variant="title" numberOfLines={1}>
          Songs
        </Text>
        <Text variant="label">{formatCount(tracks.length, 'track')}</Text>
      </View>

      <FlashList
        data={tracks}
        keyExtractor={(track) => String(track.id)}
        showsVerticalScrollIndicator={false}
        renderItem={({ item, index }) => (
          <TrackRow
            track={item}
            subtitle={item.album}
            active={item.path === currentPath}
            onPress={() => playFrom(index)}
            onLongPress={() => setActionTrack(item)}
            onOpenActions={() => setActionTrack(item)}
          />
        )}
        ListEmptyComponent={<EmptyList label="No songs found for this artist." />}
        contentContainerStyle={styles.listContent}
      />

      <TrackActionsSheet track={actionTrack} onClose={() => setActionTrack(null)} />
    </Screen>
  );
}

function EmptyList({ label }: { label: string }) {
  const colors = useColors();
  return (
    <View style={styles.emptyState}>
      <Ionicons name="musical-notes" size={24} color={colors.textTertiary} />
      <Text variant="body" color={colors.textSecondary} style={styles.emptyText}>
        {label}
      </Text>
    </View>
  );
}

function formatCount(count: number, noun: string): string {
  return `${count} ${count === 1 ? noun : `${noun}s`}`;
}

const styles = StyleSheet.create({
  back: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    marginTop: spacing.md,
    marginBottom: spacing.lg,
    alignSelf: 'flex-start',
    maxWidth: '100%',
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

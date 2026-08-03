import { useState } from 'react';
import {
  StyleSheet,
  View
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { FlashList } from '@shopify/flash-list';
import { useRouter } from 'expo-router';
import { Screen } from '@/components/Screen';
import { ScreenHeader, useScreenHeader } from '@/components/ScreenHeader';
import { Text } from '@/components/Text';
import { TrackRow } from '@/components/library/TrackRow';
import { TrackActionsSheet } from '@/components/library/TrackActionsSheet';
import { spacing } from '@/theme';
import { useColors } from '@/theme/themed';
import { useLibraryStore } from '@/stores/libraryStore';
import { usePlayerStore } from '@/stores/playerStore';
import { playLibraryQuery } from '@/audio/playbackController';
import type { DbTrack } from '@/types/library';

function formatCount(count: number, noun: string): string {
  return `${count} ${count === 1 ? noun : `${noun}s`}`;
}

function EmptyList() {
  const colors = useColors();
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
  const header = useScreenHeader({ hasSubtitle: true });
  const router = useRouter();
  const tracks = useLibraryStore((s) => s.recentlyPlayedTracks);
  const currentPath = usePlayerStore((s) => s.currentTrack?.path);
  const [actionTrack, setActionTrack] = useState<DbTrack | null>(null);

  const playFrom = (index: number) => {
    if (tracks.length === 0) return;
    void playLibraryQuery({ kind: 'recent' }, {
      anchorPath: tracks[index]?.path,
      source: { kind: 'recently-played', label: 'Recently Played' },
    });
  };

  return (
    // The header is an overlay the list scrolls under, so the screen keeps
    // neither the top inset nor the gutter — both move into the list itself.
    <Screen padded={false} style={styles.screen}>
      <FlashList
        data={tracks}
        keyExtractor={(track) => track.path}
        showsVerticalScrollIndicator={false}
        onScroll={header.onScroll}
        scrollEventThrottle={header.scrollEventThrottle}
        renderItem={({ item, index }) => (
          <TrackRow
            track={item}
            active={item.path === currentPath}
            swipeToQueue={false}
            onPress={() => playFrom(index)}
            onLongPress={() => setActionTrack(item)}
            onOpenActions={() => setActionTrack(item)}
          />
        )}
        ListEmptyComponent={<EmptyList />}
        contentContainerStyle={[styles.listContent, { paddingTop: header.contentPaddingTop }]}
      />

      <ScreenHeader
        header={header}
        title="Recently Played"
        subtitle={formatCount(tracks.length, 'track')}
        backLabel="Home"
        onBack={() => router.back()}
      />

      <TrackActionsSheet track={actionTrack} onClose={() => setActionTrack(null)} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  // The header draws behind the status bar; the list pays the inset instead.
  screen: {
    paddingTop: 0,
  },
  listContent: {
    paddingHorizontal: spacing.lg,
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

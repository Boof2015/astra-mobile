import { useState } from 'react';
import {
  StyleSheet,
  View
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { FlashList } from '@shopify/flash-list';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Screen } from '@/components/Screen';
import { ScreenHeader, useScreenHeader } from '@/components/ScreenHeader';
import { Text } from '@/components/Text';
import { TrackRow } from '@/components/library/TrackRow';
import { TrackActionsSheet } from '@/components/library/TrackActionsSheet';
import { spacing } from '@/theme';
import { useColors } from '@/theme/themed';
import { usePlayerStore } from '@/stores/playerStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { playLibraryQuery } from '@/audio/playbackController';
import { useNativeArtistDetail } from '@/library/nativePages';
import type { DbTrack } from '@/types/library';
import { useSceneBottomInset } from '@/navigation/useShellLayout';

export default function ArtistSongsScreen() {
  const sceneBottomInset = useSceneBottomInset();
  const header = useScreenHeader({ hasSubtitle: true });
  const router = useRouter();
  const { name = 'Artist', credit } = useLocalSearchParams<{
    name: string;
    credit?: string;
  }>();
  const groupingMode = useSettingsStore((s) => s.artistGroupingMode);
  const detailGroupingMode = credit === '1' ? 'astra' : groupingMode;
  const currentPath = usePlayerStore((s) => s.currentTrack?.path);
  const [actionTrack, setActionTrack] = useState<DbTrack | null>(null);

  const { items: tracks, totalCount, loadMore } = useNativeArtistDetail(
    name,
    detailGroupingMode,
    'songs'
  );

  const playFrom = (index: number) => {
    if (tracks.length === 0) return;
    void playLibraryQuery({
      kind: 'artist',
      artistKey: name,
      groupingMode: detailGroupingMode,
      section: 'songs',
    }, {
      anchorPath: tracks[index]?.path,
      source: { kind: 'artist', label: name },
    });
  };

  return (
    // The header is an overlay the list scrolls under, so the screen keeps
    // neither the top inset nor the gutter — both move into the list itself.
    <Screen padded={false} style={styles.screen}>
      <FlashList
        data={tracks}
        keyExtractor={(track) => String(track.id)}
        showsVerticalScrollIndicator={false}
        onScroll={header.onScroll}
        scrollEventThrottle={header.scrollEventThrottle}
        onEndReached={() => void loadMore()}
        onEndReachedThreshold={2}
        renderItem={({ item, index }) => (
          <TrackRow
            track={item}
            subtitle={item.album}
            showFormat={false}
            active={item.path === currentPath}
            onPress={() => playFrom(index)}
            onLongPress={() => setActionTrack(item)}
            onOpenActions={() => setActionTrack(item)}
          />
        )}
        ListEmptyComponent={<EmptyList label="No songs found for this artist." />}
        contentContainerStyle={{
          paddingTop: header.contentPaddingTop,
          paddingHorizontal: spacing.lg,
          paddingBottom: sceneBottomInset,
        }}
      />

      <ScreenHeader
        header={header}
        title="Songs"
        subtitle={formatCount(totalCount, 'track')}
        backLabel={name}
        onBack={() => router.back()}
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
  // The header draws behind the status bar; the list pays the inset instead.
  screen: {
    paddingTop: 0,
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

import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  StyleSheet,
  View
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { ReanimatedFlashList } from '@/components/ReanimatedFlashList';
import { Screen } from '@/components/Screen';
import { AppPressable } from '@/components/AppPressable';
import { showAppDialog } from '@/components/dialogs/AppDialog';
import { useSceneBottomInset } from '@/navigation/useShellLayout';
import { ScreenHeader, useScreenHeader } from '@/components/ScreenHeader';
import { Text } from '@/components/Text';
import { TrackRow } from '@/components/library/TrackRow';
import { TrackActionsSheet } from '@/components/library/TrackActionsSheet';
import { spacing } from '@/theme';
import { useColors } from '@/theme/themed';
import { formatPlayTime, nextLocalDay } from '@/listeningStats/recentTimeline';
import { useRecentTimeline } from '@/listeningStats/useRecentTimeline';
import { usePlayerStore } from '@/stores/playerStore';
import { playLibraryQuery } from '@/audio/playbackController';
import type { DbTrack, RecentTrackSummary } from '@/types/library';
import { AstraLibraryData, type RecentTimelineEntry } from '../../modules/astra-library-scanner';

function EmptyList() {
  const colors = useColors();
  return (
    <View style={styles.emptyState}>
      <Ionicons name="time-outline" size={24} color={colors.textTertiary} />
      <Text variant="body" color={colors.textSecondary} style={styles.emptyText}>
        No plays in the last 30 days.
      </Text>
    </View>
  );
}

export default function RecentlyPlayedScreen() {
  const header = useScreenHeader({ hasSubtitle: true });
  const colors = useColors();
  const sceneBottomInset = useSceneBottomInset();
  const router = useRouter();
  const history = useRecentTimeline();
  const scrolled = useRef(false);
  const currentPath = usePlayerStore((s) => s.currentTrack?.path);
  const [actionTrack, setActionTrack] = useState<DbTrack | null>(null);
  const actionRequest = useRef(0);
  useEffect(() => () => { actionRequest.current++; }, []);

  const openActions = async (path: string) => {
    const request = ++actionRequest.current;
    try {
      const track = await AstraLibraryData.getTrack<DbTrack>(path);
      if (request !== actionRequest.current) return;
      if (!track) throw new Error('This song is no longer available.');
      setActionTrack(track);
    } catch (error) {
      if (request === actionRequest.current) showAppDialog({
        title: 'Could not open track actions',
        message: error instanceof Error ? error.message : 'Please try again.',
      });
    }
  };

  const playFrom = (entry: RecentTimelineEntry<RecentTrackSummary>) => {
    void playLibraryQuery({
      kind: 'recentDay',
      generation: history.generation,
      entryKind: entry.kind,
      id: entry.id,
      playedAt: entry.playedAt,
      dayEnd: nextLocalDay(entry.playedAt),
    }, {
      anchorPath: entry.path,
      source: { kind: 'recently-played', label: 'Recently Played' },
    }).catch((error: unknown) => {
      showAppDialog({
        title: 'Could not replay this song',
        message: error instanceof Error ? error.message : 'Please try again.',
        actions: [{ label: 'OK' }],
      });
    });
  };

  return (
    // The header is an overlay the list scrolls under, so the screen keeps
    // neither the top inset nor the gutter — both move into the list itself.
    <Screen padded={false} bleedBottom style={styles.screen}>
      <ReanimatedFlashList
        data={history.rows}
        keyExtractor={(row) => row.key}
        getItemType={(row) => row.kind}
        onViewableItemsChanged={({ viewableItems }) => {
          history.setTopVisible(viewableItems.some(item => item.index === 0));
        }}
        onScrollBeginDrag={() => { scrolled.current = true; }}
        onEndReached={() => {
          if (scrolled.current && !history.error) history.loadMore();
        }}
        onEndReachedThreshold={0.5}
        showsVerticalScrollIndicator={false}
        onScroll={header.onScroll}
        scrollEventThrottle={header.scrollEventThrottle}
        renderItem={({ item }) => {
          if (item.kind === 'heading') {
            return <Text accessibilityRole="header" variant="heading" style={styles.day}>{item.title}</Text>;
          }
          const { entry, count } = item;
          const { track } = entry;
          const time = formatPlayTime(entry.playedAt);
          if (!track) {
            return (
              <View style={styles.unavailable}>
                <Ionicons name="musical-note-outline" size={22} color={colors.textTertiary} />
                <View style={styles.unavailableMeta}>
                  <Text numberOfLines={1} color={colors.textSecondary}>{entry.title || 'Unavailable track'}</Text>
                  <Text variant="caption">{[entry.artist, 'Unavailable', count > 1 && `${count} plays`].filter(Boolean).join(' · ')}</Text>
                </View>
                <Text variant="caption">{time}</Text>
              </View>
            );
          }
          return (
            <TrackRow
              track={track}
              active={entry.path === currentPath}
              swipeToQueue={false}
              showFormat={false}
              trailingText={time}
              trailingDetail={count > 1 ? `${count} plays` : undefined}
              onPress={() => playFrom(entry)}
              onOpenActions={() => void openActions(track.path)}
            />
          );
        }}
        ListEmptyComponent={!history.loading && !history.error ? <EmptyList /> : null}
        ListFooterComponent={
          history.loading ? (
            <ActivityIndicator style={styles.footer} color={colors.textTertiary} />
          ) : history.error || history.hasMore ? (
            <AppPressable
              accessibilityRole="button" feedback="control" style={styles.footer}
              onPress={history.error ? history.retry : history.loadMore}
            >
              <Text variant="label" color={colors.accentText}>
                {history.error ? 'Could not load history · Retry' : 'Show older plays'}
              </Text>
            </AppPressable>
          ) : null
        }
        contentContainerStyle={[
          styles.listContent,
          { paddingTop: header.contentPaddingTop, paddingBottom: spacing.xxl + sceneBottomInset },
        ]}
      />

      <ScreenHeader
        header={header}
        title="Recently Played"
        subtitle="Last 30 days"
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
  },
  day: {
    marginTop: spacing.lg,
    marginBottom: spacing.xs,
  },
  footer: {
    alignItems: 'center',
    paddingVertical: spacing.lg,
  },
  unavailable: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: 64,
    paddingHorizontal: spacing.sm,
  },
  unavailableMeta: { flex: 1 },
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

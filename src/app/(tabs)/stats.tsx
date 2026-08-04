import { useCallback, useMemo } from 'react';
import {
  AppState,
  Pressable,
  RefreshControl,
  StyleSheet,
  View,
} from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { Screen } from '@/components/Screen';
import { ScreenHeader, useScreenHeader } from '@/components/ScreenHeader';
import { Text } from '@/components/Text';
import { SegmentedControl } from '@/components/SegmentedControl';
import { ActivityChart } from '@/components/listening/ActivityChart';
import { listeningArtworkSource } from '@/library/artwork';
import { formatListeningTime, formatRecordedSince } from '@/listeningStats/format';
import { useHomeLibraryNavigation } from '@/navigation/useHomeLibraryNavigation';
import { useListeningStatsStore } from '@/stores/listeningStatsStore';
import { playLibraryQuery } from '@/audio/playbackController';
import { fonts, radius, spacing } from '@/theme';
import { createThemedStyles, useColors } from '@/theme/themed';
import { useRipple } from '@/theme/ripple';
import type {
  ListeningStatsCategory,
  ListeningStatsDashboard,
  ListeningStatsRankingMetric,
  RankedListeningAlbum,
  RankedListeningArtist,
  RankedListeningTrack,
} from '@/types/listeningStats';
import { subscribeToListeningHistory } from '@/listeningStats/events';
import { useSceneBottomInset } from '@/navigation/useShellLayout';

const RANGE_SEGMENTS = [
  { key: '7d', label: '7D' },
  { key: '30d', label: '30D' },
  { key: '1y', label: '1Y' },
  { key: 'all', label: 'All' },
];
const METRIC_SEGMENTS = [
  { key: 'plays', label: 'Plays' },
  { key: 'time', label: 'Time' },
];
const CATEGORY_SEGMENTS = [
  { key: 'tracks', label: 'Tracks' },
  { key: 'artists', label: 'Artists' },
  { key: 'albums', label: 'Albums' },
];

/** Checkpoints land every ~10s of playback; collapse a burst into one query. */
const HISTORY_REFRESH_DEBOUNCE_MS = 2_000;
const BACKGROUND_REFRESH_MS = 15_000;
/** Sections rise in sequence so the page assembles instead of snapping in. */
const SECTION_STEP_MS = 60;

function sectionEntering(index: number) {
  return FadeInDown.delay(index * SECTION_STEP_MS).duration(260);
}

/** The one number that leads the page; everything else supports it. */
function HeroStat({ dashboard }: { dashboard: ListeningStatsDashboard }) {
  const styles = useStyles();
  const colors = useColors();
  const plays = dashboard.summary.qualifiedPlays;
  return (
    <View style={styles.hero}>
      <Text style={styles.heroValue} numberOfLines={1}>
        {formatListeningTime(dashboard.summary.listenedSeconds, true)}
      </Text>
      <Text variant="body" color={colors.textSecondary}>
        listening time · {plays} qualified {plays === 1 ? 'play' : 'plays'}
      </Text>
    </View>
  );
}

function SummaryPair({ dashboard }: { dashboard: ListeningStatsDashboard }) {
  const styles = useStyles();
  const colors = useColors();
  const tiles = [
    ['Tracks Played', String(dashboard.summary.tracksPlayed)],
    ['Active Days', String(dashboard.summary.activeDays)],
  ];
  return (
    <View style={styles.summaryGrid}>
      {tiles.map(([label, value]) => (
        <View key={label} style={styles.summaryTile}>
          <Text variant="title" style={styles.summaryValue} numberOfLines={1}>{value}</Text>
          <Text variant="caption" color={colors.textSecondary}>{label}</Text>
        </View>
      ))}
    </View>
  );
}

type RankedItem = RankedListeningTrack | RankedListeningArtist | RankedListeningAlbum;

function rankingCopy(item: RankedItem, category: ListeningStatsCategory) {
  if (category === 'tracks') {
    const track = item as RankedListeningTrack;
    return { title: track.title, subtitle: track.artist, icon: 'musical-note' as const };
  }
  if (category === 'artists') {
    return {
      title: (item as RankedListeningArtist).artist,
      subtitle: 'Artist',
      icon: 'person' as const,
    };
  }
  const album = item as RankedListeningAlbum;
  return { title: album.album, subtitle: album.artist, icon: 'disc' as const };
}

function metricValue(item: RankedItem, metric: ListeningStatsRankingMetric): number {
  return metric === 'plays' ? item.qualifiedPlays : item.listenedSeconds;
}

function RankingRow({
  item,
  index,
  category,
  selectedMetric,
  share,
  onPress,
}: {
  item: RankedItem;
  index: number;
  category: ListeningStatsCategory;
  selectedMetric: ListeningStatsRankingMetric;
  /** 0–1 against the top-ranked entry, for the inline proportion bar. */
  share: number;
  onPress: () => void;
}) {
  const styles = useStyles();
  const colors = useColors();
  const ripple = useRipple();
  const copy = rankingCopy(item, category);
  const art = listeningArtworkSource(item, true);
  return (
    <Pressable
      style={[styles.rankingRow, !item.available && styles.unavailable]}
      android_ripple={item.available ? ripple.bounded : undefined}
      disabled={!item.available}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ disabled: !item.available }}
      accessibilityLabel={`${index + 1}. ${copy.title}`}
    >
      <Text variant="label" style={styles.rankNumber}>{index + 1}</Text>
      <View style={styles.rankingArt}>
        {art ? (
          <Image source={{ uri: art }} style={styles.artImage} contentFit="cover" />
        ) : (
          <Ionicons name={copy.icon} size={22} color={colors.textTertiary} />
        )}
      </View>
      <View style={styles.rankingMeta}>
        <Text variant="body" numberOfLines={1}>{copy.title}</Text>
        <Text variant="caption" color={colors.textSecondary} numberOfLines={1}>
          {item.available ? copy.subtitle : `${copy.subtitle} · Unavailable`}
        </Text>
        {/* Turns the list into a visible ranking rather than a column of numbers.
            Safe as a percentage: the row has a definite width. */}
        <View style={styles.shareTrack}>
          <View
            style={[
              styles.shareFill,
              { width: `${Math.round(share * 100)}%`, backgroundColor: colors.accent },
            ]}
          />
        </View>
      </View>
      <View style={styles.rankingMetrics}>
        <Text
          variant="label"
          color={selectedMetric === 'plays' ? colors.accentText : colors.textSecondary}
        >
          {item.qualifiedPlays} {item.qualifiedPlays === 1 ? 'play' : 'plays'}
        </Text>
        <Text
          variant="caption"
          color={selectedMetric === 'time' ? colors.accentText : colors.textTertiary}
        >
          {formatListeningTime(item.listenedSeconds, true)}
        </Text>
      </View>
    </Pressable>
  );
}

function EmptyState({
  icon,
  title,
  body,
  action,
  onAction,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  body: string;
  action?: string;
  onAction?: () => void;
}) {
  const styles = useStyles();
  const colors = useColors();
  const ripple = useRipple();
  return (
    <View style={styles.empty}>
      <Ionicons name={icon} size={34} color={colors.textTertiary} />
      <Text variant="heading">{title}</Text>
      <Text variant="body" color={colors.textSecondary} style={styles.emptyBody}>{body}</Text>
      {action && onAction ? (
        <Pressable style={styles.primaryButton} android_ripple={ripple.onAccent()} onPress={onAction}>
          <Text variant="body" style={styles.primaryButtonText}>{action}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

export default function ListeningStatsScreen() {
  const sceneBottomInset = useSceneBottomInset();
  const header = useScreenHeader({ hasSubtitle: true });
  const styles = useStyles();
  const colors = useColors();
  const router = useRouter();
  const openLibrary = useHomeLibraryNavigation();
  const range = useListeningStatsStore((s) => s.range);
  const metric = useListeningStatsStore((s) => s.rankingMetric);
  const category = useListeningStatsStore((s) => s.category);
  const dashboard = useListeningStatsStore((s) => s.dashboard);
  const loading = useListeningStatsStore((s) => s.loading);
  const refreshing = useListeningStatsStore((s) => s.refreshing);
  const error = useListeningStatsStore((s) => s.error);
  const setRange = useListeningStatsStore((s) => s.setRange);
  const setMetric = useListeningStatsStore((s) => s.setRankingMetric);
  const setCategory = useListeningStatsStore((s) => s.setCategory);
  const load = useListeningStatsStore((s) => s.loadDashboard);

  useFocusEffect(
    useCallback(() => {
      // Background reloads stay silent so the pull-to-refresh spinner only ever
      // appears for an actual pull.
      const refresh = () => void load({ silent: true });
      refresh();
      const interval = setInterval(refresh, BACKGROUND_REFRESH_MS);
      let debounce: ReturnType<typeof setTimeout> | null = null;
      const unsubscribe = subscribeToListeningHistory(() => {
        if (debounce) clearTimeout(debounce);
        debounce = setTimeout(refresh, HISTORY_REFRESH_DEBOUNCE_MS);
      });
      const subscription = AppState.addEventListener('change', (state) => {
        if (state === 'active') refresh();
      });
      return () => {
        clearInterval(interval);
        if (debounce) clearTimeout(debounce);
        unsubscribe();
        subscription.remove();
      };
    }, [load]),
  );

  const rankings = useMemo<RankedItem[]>(() => {
    if (!dashboard) return [];
    if (category === 'artists') return dashboard.topArtists;
    if (category === 'albums') return dashboard.topAlbums;
    return dashboard.topTracks;
  }, [category, dashboard]);

  // Rankings arrive sorted by the active metric, so the leader sets the scale.
  const rankingPeak = rankings.length > 0 ? metricValue(rankings[0], metric) : 0;

  const openRanking = (item: RankedItem) => {
    if (!dashboard || !item.available) return;
    if (category === 'tracks') {
      const paths = dashboard.topTracks.flatMap((track) =>
        track.available && track.trackPath ? [track.trackPath] : []
      );
      const track = item as RankedListeningTrack;
      if (!track.trackPath || paths.length === 0) return;
      void playLibraryQuery(
        { kind: 'manual', paths },
        {
          anchorPath: track.trackPath,
          source: { kind: 'listening-stats', label: 'Listening Stats' },
        },
      );
      return;
    }
    if (category === 'artists') {
      openLibrary({ kind: 'artist', name: (item as RankedListeningArtist).artist });
    } else {
      openLibrary({ kind: 'album', key: item.key });
    }
  };

  const noActivity = dashboard
    ? dashboard.summary.listenedSeconds <= 0 && dashboard.summary.qualifiedPlays <= 0
    : false;

  return (
    // The header is an overlay the content scrolls under, so the screen keeps
    // neither the top inset nor the gutter — both move into the ScrollView.
    <Screen padded={false} style={styles.screen}>
      <Animated.ScrollView
        showsVerticalScrollIndicator={false}
        onScroll={header.onScroll}
        scrollEventThrottle={header.scrollEventThrottle}
        contentContainerStyle={[
          styles.content,
          { paddingTop: header.contentPaddingTop, paddingBottom: sceneBottomInset },
        ]}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => void load()}
            tintColor={colors.accent}
            colors={[colors.accent]}
            // Android's SwipeRefreshLayout places the spinner against the
            // ScrollView, not the content, so contentContainerStyle padding
            // does not move it — without this it spins behind the header.
            progressViewOffset={header.contentPaddingTop}
          />
        }
      >
        <SegmentedControl
          segments={RANGE_SEGMENTS}
          value={range}
          onChange={(value) => setRange(value as typeof range)}
        />

        {loading && !dashboard ? (
          <EmptyState
            icon="stats-chart"
            title="Loading Listening Stats"
            body="Reading the detailed history recorded on this phone…"
          />
        ) : error && !dashboard ? (
          <EmptyState
            icon="cloud-offline-outline"
            title="Stats could not load"
            body={error}
            action="Try again"
            onAction={() => void load()}
          />
        ) : !dashboard?.status.startedAt ? (
          <EmptyState
            icon={dashboard?.status.enabled === false ? 'pause-circle-outline' : 'headset-outline'}
            title={dashboard?.status.enabled === false ? 'Listening History is paused' : 'Your stats start here'}
            body={
              dashboard?.status.enabled === false
                ? 'Resume Listening History in Playback settings. Play counts and other library data are unchanged.'
                : 'Play music on this phone to begin detailed listening time, activity, and rankings. Existing play counts are not backfilled.'
            }
            action={dashboard?.status.enabled === false ? 'Playback settings' : undefined}
            onAction={() => router.push('/settings/playback' as never)}
          />
        ) : (
          <>
            {!dashboard.status.enabled ? (
              <View style={styles.pausedBanner}>
                <Ionicons name="pause-circle-outline" size={20} color={colors.warning} />
                <View style={styles.bannerCopy}>
                  <Text variant="label" color={colors.warning}>History paused</Text>
                  <Text variant="caption" color={colors.textSecondary}>
                    Existing history is shown; future listening is not being recorded.
                  </Text>
                </View>
              </View>
            ) : null}

            <Animated.View entering={sectionEntering(0)}>
              <HeroStat dashboard={dashboard} />
            </Animated.View>

            {/* Page-level: drives the chart's bars as well as the rankings. */}
            <SegmentedControl
              segments={METRIC_SEGMENTS}
              value={metric}
              onChange={(value) => setMetric(value as typeof metric)}
            />

            {noActivity ? (
              <EmptyState
                icon="calendar-outline"
                title="No activity in this range"
                body="Choose another range or keep listening to fill this view."
              />
            ) : (
              <>
                {/* Keyed so a range or metric change remounts the chart: the reveal
                    restarts and the bucket selection resets. Same-range refreshes
                    reuse the mount, so bars glide instead of re-sweeping. */}
                <Animated.View entering={sectionEntering(1)}>
                  <ActivityChart
                    key={`${dashboard.range}-${metric}`}
                    buckets={dashboard.activity}
                    granularity={dashboard.granularity}
                    metric={metric}
                  />
                </Animated.View>

                <Animated.View entering={sectionEntering(2)}>
                  <SummaryPair dashboard={dashboard} />
                </Animated.View>

                <Animated.View entering={sectionEntering(3)} style={styles.rankingsSection}>
                  <View style={styles.rankingsHeader}>
                    <Text variant="heading">Rankings</Text>
                    {error ? (
                      <Pressable onPress={() => void load()} accessibilityRole="button">
                        <Text variant="caption" color={colors.warning}>Refresh failed · Retry</Text>
                      </Pressable>
                    ) : null}
                  </View>
                  <SegmentedControl
                    segments={CATEGORY_SEGMENTS}
                    value={category}
                    onChange={(value) => setCategory(value as ListeningStatsCategory)}
                  />
                  <View style={styles.rankingList}>
                    {rankings.map((item, index) => (
                      <RankingRow
                        key={item.key}
                        item={item}
                        index={index}
                        category={category}
                        selectedMetric={metric}
                        share={rankingPeak > 0 ? metricValue(item, metric) / rankingPeak : 0}
                        onPress={() => openRanking(item)}
                      />
                    ))}
                  </View>
                </Animated.View>
              </>
            )}
          </>
        )}
      </Animated.ScrollView>

      <ScreenHeader
        header={header}
        title="Listening Stats"
        subtitle={formatRecordedSince(dashboard?.status.startedAt ?? null)}
        backLabel="Home"
        onBack={() => router.back()}
      />
    </Screen>
  );
}

const useStyles = createThemedStyles((colors) => ({
  // The header draws behind the status bar; the ScrollView pays the inset.
  screen: {
    paddingTop: 0,
  },
  content: {
    paddingHorizontal: spacing.lg,
    gap: spacing.lg,
  },
  pausedBanner: {
    flexDirection: 'row',
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.warning,
    backgroundColor: colors.glassBg,
  },
  bannerCopy: {
    flex: 1,
    gap: 2,
  },
  hero: {
    gap: spacing.xs,
    paddingTop: spacing.xs,
  },
  heroValue: {
    fontSize: 44,
    lineHeight: 50,
    color: colors.textPrimary,
    fontFamily: fonts.sans.bold,
  },
  summaryGrid: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  summaryTile: {
    flex: 1,
    minWidth: 0,
    padding: spacing.lg,
    gap: spacing.xs,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glassBorder,
    backgroundColor: colors.glassBg,
  },
  summaryValue: {
    fontSize: 24,
    lineHeight: 29,
  },
  rankingsSection: {
    gap: spacing.md,
  },
  rankingsHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: spacing.sm,
  },
  rankingList: {
    borderRadius: radius.md,
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glassBorder,
    backgroundColor: colors.glassBg,
  },
  rankingRow: {
    minHeight: 68,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.glassBorder,
  },
  rankNumber: {
    width: 22,
    textAlign: 'center',
    fontFamily: fonts.mono.medium,
  },
  rankingArt: {
    width: 46,
    height: 46,
    borderRadius: radius.sm,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.bgTertiary,
  },
  artImage: {
    width: '100%',
    height: '100%',
  },
  rankingMeta: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  shareTrack: {
    marginTop: 3,
    height: 3,
    borderRadius: 2,
    overflow: 'hidden',
    backgroundColor: colors.bgTertiary,
  },
  shareFill: {
    height: '100%',
    borderRadius: 2,
  },
  rankingMetrics: {
    alignItems: 'flex-end',
    gap: 2,
  },
  empty: {
    minHeight: 220,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    padding: spacing.xl,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glassBorder,
    backgroundColor: colors.glassBg,
  },
  emptyBody: {
    maxWidth: 440,
    textAlign: 'center',
    lineHeight: 21,
  },
  primaryButton: {
    marginTop: spacing.sm,
    minHeight: 40,
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
    borderRadius: radius.pill,
    backgroundColor: colors.accent,
    overflow: 'hidden',
  },
  primaryButtonText: {
    color: colors.bgPrimary,
    fontFamily: fonts.sans.semibold,
  },
  unavailable: {
    opacity: 0.48,
  },
}));

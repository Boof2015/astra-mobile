import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { AstraLogo } from '@/components/AstraLogo';
import { Text } from '@/components/Text';
import { listeningArtworkSource } from '@/library/artwork';
import { formatListeningTime } from '@/listeningStats/format';
import { radius, spacing } from '@/theme';
import { createThemedStyles, useColors } from '@/theme/themed';
import { AppPressable } from '@/components/AppPressable';
import type { ListeningStatsDashboard } from '@/types/listeningStats';

/**
 * True when the card has something to draw. Callers seating it in a layout need
 * this *before* rendering: a card that returns null still occupies a column, so
 * the row beside it would sit half empty rather than closing up.
 */
export function hasListeningPreview(dashboard: ListeningStatsDashboard | null): boolean {
  return Boolean(dashboard?.status.startedAt);
}

export function ListeningPreviewCard({
  dashboard,
  onPress,
  style,
}: {
  dashboard: ListeningStatsDashboard | null;
  onPress: () => void;
  style?: StyleProp<ViewStyle>;
}) {
  const styles = useStyles();
  const colors = useColors();
  if (!hasListeningPreview(dashboard) || !dashboard) return null;

  const topTrack = dashboard.topTracks[0] ?? null;
  const artwork = topTrack ? listeningArtworkSource(topTrack, true) : null;
  const paused = !dashboard.status.enabled;

  return (
    <AppPressable
      style={[styles.card, style]}
      feedback="tile"
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel="Open Listening Stats"
    >
      <View style={styles.header}>
        <View style={styles.titleRow}>
          <Ionicons
            name={paused ? 'pause-circle-outline' : 'stats-chart'}
            size={18}
            color={paused ? colors.warning : colors.accent}
          />
          <Text variant="heading">Your Listening</Text>
        </View>
        <Ionicons name="chevron-forward" size={18} color={colors.textTertiary} />
      </View>

      {paused ? (
        <View style={styles.paused}>
          <Text variant="label" color={colors.warning}>History paused</Text>
          <Text variant="caption" color={colors.textSecondary}>
            Existing stats are still available. Resume recording in Playback settings.
          </Text>
        </View>
      ) : null}

      <View style={styles.metrics}>
        <View style={styles.metric}>
          <Text variant="title" style={styles.metricValue} numberOfLines={1}>
            {formatListeningTime(dashboard.summary.listenedSeconds, true)}
          </Text>
          <Text variant="caption" color={colors.textSecondary}>Last 7 days</Text>
        </View>
        <View style={styles.metric}>
          <Text variant="title" style={styles.metricValue} numberOfLines={1}>
            {dashboard.summary.qualifiedPlays}
          </Text>
          <Text variant="caption" color={colors.textSecondary}>Qualified plays</Text>
        </View>
      </View>

      {topTrack ? (
        <View style={styles.topTrack}>
          <View style={styles.art}>
            {artwork ? (
              <Image source={{ uri: artwork }} style={styles.image} contentFit="cover" />
            ) : (
              <AstraLogo size={24} />
            )}
          </View>
          <View style={styles.trackMeta}>
            <Text variant="label" color={colors.textTertiary}>TOP TRACK</Text>
            <Text variant="body" numberOfLines={1}>{topTrack.title}</Text>
            <Text variant="caption" color={colors.textSecondary} numberOfLines={1}>
              {topTrack.artist} · {topTrack.qualifiedPlays} {topTrack.qualifiedPlays === 1 ? 'play' : 'plays'}
            </Text>
          </View>
        </View>
      ) : (
        <Text variant="caption" color={colors.textSecondary}>
          No qualified plays in the last 7 days.
        </Text>
      )}
    </AppPressable>
  );
}

const useStyles = createThemedStyles((colors) => ({
  card: {
    // No outer margin: the card is seated by whatever lays it out (Home puts it
    // in a band beside the spotlight card), and a margin of its own would
    // double up against that band's spacing.
    padding: spacing.lg,
    gap: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.glassBg,
    borderColor: colors.glassBorder,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  paused: {
    gap: 2,
  },
  metrics: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  metric: {
    flex: 1,
    minWidth: 0,
  },
  metricValue: {
    fontSize: 22,
    lineHeight: 27,
  },
  topTrack: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  art: {
    width: 52,
    height: 52,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    borderRadius: radius.sm,
    backgroundColor: colors.bgTertiary,
  },
  image: {
    width: '100%',
    height: '100%',
  },
  trackMeta: {
    flex: 1,
    minWidth: 0,
    gap: 1,
  },
}));

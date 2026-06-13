import { View, Pressable, StyleSheet } from 'react-native';
import { Text } from '@/components/Text';
import { FormatBadges } from '@/components/FormatBadge';
import { colors, spacing } from '@/theme';
import { formatDuration } from '@/lib/format';
import type { DbTrack } from '@/types/library';

export function TrackRow({
  track,
  onPress,
  onLongPress,
  showArtist = true,
  active = false,
}: {
  track: DbTrack;
  onPress: () => void;
  /** Opens the track actions sheet where wired. */
  onLongPress?: () => void;
  /** Hide on album detail where every row shares the artist. */
  showArtist?: boolean;
  active?: boolean;
}) {
  return (
    <Pressable
      style={styles.row}
      onPress={onPress}
      onLongPress={onLongPress}
      accessibilityRole="button"
    >
      {track.track_number != null && !showArtist ? (
        <Text variant="mono" style={styles.trackNumber}>
          {track.track_number}
        </Text>
      ) : null}

      <View style={styles.meta}>
        <Text
          variant="body"
          numberOfLines={1}
          style={[styles.title, active && styles.titleActive]}
        >
          {track.title}
        </Text>
        {showArtist ? (
          <Text variant="label" numberOfLines={1}>
            {track.artist}
          </Text>
        ) : null}
        <View style={styles.badges}>
          <FormatBadges
            track={{
              format: track.format,
              bitDepth: track.bit_depth ?? undefined,
              sampleRate: track.sample_rate ?? undefined,
            }}
          />
        </View>
      </View>

      <Text variant="mono" style={styles.duration}>
        {formatDuration(track.duration)}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.sm + 2,
    gap: spacing.md,
    borderBottomColor: colors.glassBorder,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  trackNumber: {
    width: 24,
    fontSize: 12,
    color: colors.textTertiary,
    textAlign: 'right',
  },
  meta: {
    flex: 1,
    gap: 2,
  },
  title: {
    fontSize: 15,
  },
  titleActive: {
    color: colors.accent,
  },
  badges: {
    marginTop: 2,
  },
  duration: {
    fontSize: 12,
    color: colors.textTertiary,
  },
});

import { View, StyleSheet } from 'react-native';
import { Text } from './Text';
import { colors, radius, spacing } from '@/theme';
import type { Track } from '@/types/audio';

/** A single mono pill (e.g. "FLAC", "24-BIT", "48.0 kHz"). */
export function Badge({ label }: { label: string }) {
  return (
    <View style={styles.badge}>
      <Text variant="mono" style={styles.text}>
        {label}
      </Text>
    </View>
  );
}

/**
 * Format badge row for a track. Mirrors desktop `TrackList.tsx`:
 * `format.toUpperCase()` and `${(sampleRate / 1000).toFixed(1)} kHz`.
 */
export function FormatBadges({
  track,
}: {
  track: Pick<Track, 'format' | 'bitDepth' | 'sampleRate'>;
}) {
  const labels: string[] = [];
  if (track.format) labels.push(track.format.toUpperCase());
  if (track.bitDepth) labels.push(`${track.bitDepth}-BIT`);
  if (track.sampleRate) labels.push(`${(track.sampleRate / 1000).toFixed(1)} kHz`);

  if (labels.length === 0) return null;

  return (
    <View style={styles.row}>
      {labels.map((label) => (
        <Badge key={label} label={label} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
  },
  badge: {
    backgroundColor: colors.glassBg,
    borderColor: colors.glassBorder,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
  },
  text: {
    color: colors.accentText,
    fontSize: 10,
    letterSpacing: 0.5,
  },
});

export default FormatBadges;

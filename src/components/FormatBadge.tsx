import { View, StyleSheet } from 'react-native';
import { Text } from './Text';
import {
  colors,
  radius,
  spacing
} from '@/theme';
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
 *
 * `variant="plain"` drops the pill chrome for muted middot-joined text — used in
 * dense track lists where the pills read as too first-class next to the title.
 */
export function FormatBadges({
  track,
  wrap = true,
  variant = 'pill',
}: {
  track: Pick<Track, 'format' | 'bitDepth' | 'sampleRate'>;
  wrap?: boolean;
  variant?: 'pill' | 'plain';
}) {
  const labels: string[] = [];
  if (track.format) labels.push(track.format.toUpperCase());
  if (track.bitDepth) labels.push(`${track.bitDepth}-BIT`);
  if (track.sampleRate) labels.push(`${(track.sampleRate / 1000).toFixed(1)} kHz`);

  if (labels.length === 0) return null;

  if (variant === 'plain') {
    // Compact so it hugs its content instead of filling the row: drop the "-BIT"
    // and "kHz" words and fold depth/rate into "24/44.1".
    const parts: string[] = [];
    if (track.format) parts.push(track.format.toUpperCase());
    const rate = track.sampleRate ? (track.sampleRate / 1000).toFixed(1) : null;
    if (track.bitDepth && rate) parts.push(`${track.bitDepth}/${rate}`);
    else if (rate) parts.push(rate);
    else if (track.bitDepth) parts.push(`${track.bitDepth}-bit`);
    return (
      <Text variant="mono" style={styles.plain} numberOfLines={1}>
        {parts.join(' · ')}
      </Text>
    );
  }

  return (
    <View style={[styles.row, !wrap && styles.rowNoWrap]}>
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
  rowNoWrap: {
    flexWrap: 'nowrap',
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
  plain: {
    color: colors.textTertiary,
    fontSize: 10,
    letterSpacing: 0.3,
  },
});

export default FormatBadges;

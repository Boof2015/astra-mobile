import { StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '@/components/Text';
import { formatDuration } from '@/lib/format';
import { radius, spacing } from '@/theme';
import { createThemedStyles, useColors } from '@/theme/themed';
import type { SignalPayload } from '@boof2015/astra-signal';

/**
 * Shows the song a scanned/imported Signal decoded to. Resolving this to a
 * playable track (local library match, then online lookup) is the next phase;
 * for now it confirms the round-trip — the make-or-break for the format.
 */
export function SignalResultCard({
  payload,
  compact = false,
}: {
  payload: SignalPayload;
  compact?: boolean;
}) {
  const styles = useStyles();
  const colors = useColors();
  const title = payload.title.trim();
  const artist = payload.artist.trim();

  return (
    <View style={[styles.card, compact && styles.compactCard]}>
      <View style={[styles.signalMark, compact && styles.compactSignalMark]}>
        <Ionicons name="pulse" size={25} color={colors.accent} />
      </View>
      <Text variant="label" color={colors.accent} style={styles.foundLabel}>
        SIGNAL FOUND
      </Text>
      <Text variant="title" style={styles.title}>
        {title || 'Unknown title'}
      </Text>
      <Text variant="body" color={colors.textSecondary} style={styles.artist}>
        {artist || 'Unknown artist'}
      </Text>
      {payload.durationSec > 0 ? (
        <View style={styles.metaRow}>
          <Ionicons name="time-outline" size={15} color={colors.textTertiary} />
          <Text variant="mono" color={colors.textTertiary}>
            {formatDuration(payload.durationSec)}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

const useStyles = createThemedStyles((colors) => ({
  card: {
    minHeight: 230,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glassBorder,
    backgroundColor: colors.glassBg,
    padding: spacing.xl,
    gap: spacing.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  signalMark: {
    width: 54,
    height: 54,
    borderRadius: 27,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.accentGlow,
    marginBottom: spacing.sm,
  },
  compactCard: {
    minHeight: 0,
    padding: spacing.lg,
    gap: spacing.xs,
  },
  compactSignalMark: {
    width: 42,
    height: 42,
    borderRadius: 21,
    marginBottom: spacing.xs,
  },
  foundLabel: {
    letterSpacing: 0.8,
  },
  title: {
    marginTop: spacing.xs,
    textAlign: 'center',
  },
  artist: {
    textAlign: 'center',
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    marginTop: spacing.sm,
  },
}));

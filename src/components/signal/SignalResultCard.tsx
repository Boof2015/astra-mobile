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
export function SignalResultCard({ payload }: { payload: SignalPayload }) {
  const styles = useStyles();
  const colors = useColors();
  const title = payload.title.trim();
  const artist = payload.artist.trim();

  return (
    <View style={styles.card}>
      <View style={styles.badge}>
        <Ionicons name="pulse" size={18} color={colors.accentTextStrong} />
        <Text variant="label" color={colors.accentTextStrong}>
          Signal found
        </Text>
      </View>
      <Text variant="title" style={styles.title}>
        {title || 'Unknown title'}
      </Text>
      <Text variant="body" color={colors.textSecondary}>
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
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glassBorder,
    backgroundColor: colors.glassBg,
    padding: spacing.lg,
    gap: spacing.xs,
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    alignSelf: 'flex-start',
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderRadius: radius.pill,
    backgroundColor: colors.accentGlow,
    marginBottom: spacing.sm,
  },
  title: {
    marginTop: spacing.xs,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    marginTop: spacing.sm,
  },
}));

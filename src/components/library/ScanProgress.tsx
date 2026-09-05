import { ActionButton } from '@/components/ActionButton';
import { View } from 'react-native';
import { Text } from '@/components/Text';
import { spacing } from '@/theme';
import { createThemedStyles, useColors } from '@/theme/themed';
import { useLibraryStore } from '@/stores/libraryStore';

/** Thin accent bar + caption shown under the library header while scanning. */
export function ScanProgress() {
  const styles = useStyles();
  const colors = useColors();
  const isScanning = useLibraryStore((s) => s.isScanning);
  const isCancelling = useLibraryStore((s) => s.isCancelling);
  const progress = useLibraryStore((s) => s.scanProgress);
  const cancelScan = useLibraryStore((s) => s.cancelScan);

  if (!isScanning) return null;

  const label =
    progress.phase === 'analyzing'
      ? `Analyzing audio… ${progress.processed}/${progress.total}`
      : progress.phase === 'extracting'
        ? `Scanning ${progress.folderName ?? ''}… ${progress.processed}/${progress.total}`
        : progress.total > 0
          ? `Found ${progress.total} files in ${progress.folderName ?? ''}…`
          : `Looking for music${progress.folderName ? ` in ${progress.folderName}` : ''}…`;

  const fraction =
    (progress.phase === 'extracting' || progress.phase === 'analyzing') && progress.total > 0
      ? progress.processed / progress.total
      : 0;

  return (
    <View style={styles.container}>
      <View style={styles.labelRow}>
        <Text
          variant="caption"
          color={colors.textSecondary}
          numberOfLines={1}
          style={styles.label}
        >
          {label}
        </Text>
        <ActionButton
          disabled={isCancelling}
          onPress={cancelScan}
          accessibilityLabel={isCancelling ? 'Cancelling library scan' : 'Cancel library scan'}
          accessibilityState={{ disabled: isCancelling, busy: isCancelling }}
          hitSlop={6}
          variant="secondary"
          label={isCancelling ? 'Cancelling…' : 'Cancel'}
        />
      </View>
      <View style={styles.track}>
        <View
          style={[
            styles.fill,
            // Indeterminate discovery phase shows a faint full-width bar.
            fraction > 0 ? { width: `${fraction * 100}%` } : styles.fillIndeterminate,
          ]}
        />
      </View>
    </View>
  );
}

const useStyles = createThemedStyles((colors) => ({
  container: {
    gap: spacing.xs,
    marginBottom: spacing.md,
  },
  labelRow: {
    minHeight: 32,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  label: {
    flex: 1,
  },
  track: {
    height: 2,
    backgroundColor: colors.glassBorder,
    borderRadius: 1,
    overflow: 'hidden',
  },
  fill: {
    height: 2,
    backgroundColor: colors.accent,
  },
  fillIndeterminate: {
    width: '100%',
    opacity: 0.35,
  },
}));

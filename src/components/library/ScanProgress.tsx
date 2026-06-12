import { View, StyleSheet } from 'react-native';
import { Text } from '@/components/Text';
import { colors, spacing } from '@/theme';
import { useLibraryStore } from '@/stores/libraryStore';

/** Thin accent bar + caption shown under the library header while scanning. */
export function ScanProgress() {
  const isScanning = useLibraryStore((s) => s.isScanning);
  const progress = useLibraryStore((s) => s.scanProgress);

  if (!isScanning) return null;

  const label =
    progress.phase === 'extracting'
      ? `Scanning ${progress.folderName ?? ''}… ${progress.processed}/${progress.total}`
      : progress.total > 0
        ? `Found ${progress.total} files in ${progress.folderName ?? ''}…`
        : `Looking for music${progress.folderName ? ` in ${progress.folderName}` : ''}…`;

  const fraction =
    progress.phase === 'extracting' && progress.total > 0
      ? progress.processed / progress.total
      : 0;

  return (
    <View style={styles.container}>
      <Text variant="caption" color={colors.textSecondary} numberOfLines={1}>
        {label}
      </Text>
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

const styles = StyleSheet.create({
  container: {
    gap: spacing.xs,
    marginBottom: spacing.md,
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
});

import { View, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '@/components/Text';
import { colors, radius, spacing } from '@/theme';
import { useLibraryStore } from '@/stores/libraryStore';

export function EmptyLibrary() {
  const addFolder = useLibraryStore((s) => s.addFolder);

  return (
    <View style={styles.empty}>
      <Ionicons name="musical-notes-outline" size={48} color={colors.textTertiary} />
      <Text variant="heading" style={styles.title}>
        No music yet
      </Text>
      <Text variant="body" color={colors.textSecondary} style={styles.body}>
        Pick a folder on this device and Astra will scan it into your library.
      </Text>
      <Pressable style={styles.cta} onPress={() => void addFolder()} accessibilityRole="button">
        <Ionicons name="folder-open-outline" size={18} color={colors.bgPrimary} />
        <Text variant="body" style={styles.ctaLabel}>
          Add music folder
        </Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  empty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingBottom: spacing.xxl,
  },
  title: {
    marginTop: spacing.sm,
  },
  body: {
    textAlign: 'center',
    maxWidth: 280,
  },
  cta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.accent,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
    marginTop: spacing.lg,
  },
  ctaLabel: {
    color: colors.bgPrimary,
    fontWeight: '600',
  },
});

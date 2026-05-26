import { View, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Screen } from '@/components/Screen';
import { Text } from '@/components/Text';
import { colors, spacing } from '@/theme';

export default function LibraryScreen() {
  return (
    <Screen>
      <Text variant="title" style={styles.heading}>
        Library
      </Text>

      <View style={styles.empty}>
        <Ionicons name="musical-notes-outline" size={48} color={colors.textTertiary} />
        <Text variant="heading" style={styles.emptyTitle}>
          No music yet
        </Text>
        <Text variant="body" color={colors.textSecondary} style={styles.emptyBody}>
          On-device file scanning, metadata, and the SQLite library arrive in M1.
        </Text>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  heading: {
    marginTop: spacing.xl,
    marginBottom: spacing.lg,
  },
  empty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingBottom: spacing.xxl,
  },
  emptyTitle: {
    marginTop: spacing.sm,
  },
  emptyBody: {
    textAlign: 'center',
    maxWidth: 280,
  },
});

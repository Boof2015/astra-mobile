import {
  View,
  Pressable
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { Text } from '@/components/Text';
import {
  radius,
  spacing,
} from '@/theme';
import { createThemedStyles, useColors } from '@/theme/themed';
import { useRipple } from '@/theme/ripple';
import { useLibraryStore } from '@/stores/libraryStore';

export function EmptyLibrary() {
  const styles = useStyles();
  const ripple = useRipple();
  const colors = useColors();
  const router = useRouter();
  const recoveryNotice = useLibraryStore((state) => state.recoveryNotice);
  const status = useLibraryStore((state) => state.status);
  const fatal = status === 'fatalUserData';
  const rebuilding = status === 'rebuilding';
  const degraded = status === 'degraded';

  return (
    <View style={styles.empty}>
      <Ionicons
        name={fatal || degraded ? 'warning-outline' : rebuilding ? 'construct-outline' : 'musical-notes-outline'}
        size={48}
        color={fatal || degraded ? colors.warning : colors.textTertiary}
      />
      <Text variant="heading" style={styles.title}>
        {fatal
          ? 'Library data unavailable'
          : rebuilding
            ? 'Rebuilding your library'
            : degraded
              ? 'Library temporarily unavailable'
              : 'No music yet'}
      </Text>
      <Text variant="body" color={colors.textSecondary} style={styles.body}>
        {fatal
          ? 'Astra could not restore your playlists, favorites, and settings from either safety snapshot. Your music files were not changed.'
          : rebuilding
            ? 'The catalog was quarantined and Astra is rebuilding it from your available folders.'
            : degraded
              ? 'The last valid catalog could not be opened. Astra will keep trying to recover without treating it as an empty library.'
              : recoveryNotice ??
                'Pick a folder on this device and Astra will scan it into your library.'}
      </Text>
      <Pressable
        android_ripple={ripple.bounded}
        style={styles.cta}
        onPress={() => router.push(fatal ? '/settings/troubleshooting' : '/settings')}
        accessibilityRole="button"
      >
        <Ionicons name={fatal ? 'build-outline' : 'folder-open-outline'} size={18} color={colors.bgPrimary} />
        <Text variant="body" style={styles.ctaLabel}>
          {fatal ? 'Troubleshooting' : 'Folder settings'}
        </Text>
      </Pressable>
    </View>
  );
}

const useStyles = createThemedStyles((colors) => ({
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
}));

import { Pressable, ScrollView, StyleSheet } from 'react-native';
import { Text } from '@/components/Text';
import { colors, radius, spacing } from '@/theme';

export type LibraryViewMode = 'albums' | 'artists' | 'tracks' | 'playlists' | 'folders';

const MODES: { key: LibraryViewMode; label: string }[] = [
  { key: 'albums', label: 'Albums' },
  { key: 'artists', label: 'Artists' },
  { key: 'tracks', label: 'Tracks' },
  { key: 'playlists', label: 'Playlists' },
  { key: 'folders', label: 'Folders' },
];

export function ViewModeSwitcher({
  value,
  onChange,
}: {
  value: LibraryViewMode;
  onChange: (mode: LibraryViewMode) => void;
}) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
      {MODES.map((mode) => {
        const active = mode.key === value;
        return (
          <Pressable
            key={mode.key}
            onPress={() => onChange(mode.key)}
            style={[styles.pill, active && styles.pillActive]}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
          >
            <Text
              variant="label"
              style={[styles.label, active && styles.labelActive]}
            >
              {mode.label}
            </Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  pill: {
    backgroundColor: colors.glassBg,
    borderColor: colors.glassBorder,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs + 2,
  },
  pillActive: {
    borderColor: colors.accent,
    backgroundColor: 'rgba(56, 189, 248, 0.08)',
  },
  label: {
    color: colors.textSecondary,
  },
  labelActive: {
    color: colors.accent,
  },
});

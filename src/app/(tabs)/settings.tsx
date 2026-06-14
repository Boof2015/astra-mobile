import { View, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Screen } from '@/components/Screen';
import { Text } from '@/components/Text';
import { colors, radius, spacing } from '@/theme';
import { useSettingsStore } from '@/stores/settingsStore';
import type { ArtistGroupingMode } from '@/library/artistGrouping';

const ARTIST_GROUPING_OPTIONS: { mode: ArtistGroupingMode; title: string; description: string }[] = [
  {
    mode: 'astra',
    title: 'Astra grouping',
    description: 'Parse collaborators ("feat.", "&", "x") — featured artists get their own entry.',
  },
  {
    mode: 'fileTags',
    title: 'File tags',
    description: 'Group by the album artist / artist tag exactly as written.',
  },
];

export default function SettingsScreen() {
  const groupingMode = useSettingsStore((s) => s.artistGroupingMode);
  const setArtistGroupingMode = useSettingsStore((s) => s.setArtistGroupingMode);

  return (
    <Screen>
      <Text variant="title" style={styles.heading}>
        Settings
      </Text>

      <Text variant="label" color={colors.textTertiary} style={styles.sectionLabel}>
        LIBRARY
      </Text>
      <Text variant="body" style={styles.settingTitle}>
        Artist grouping
      </Text>
      <Text variant="caption" color={colors.textSecondary} style={styles.settingNote}>
        How tracks are organized into artists in the library.
      </Text>

      <View style={styles.options}>
        {ARTIST_GROUPING_OPTIONS.map((option) => {
          const selected = option.mode === groupingMode;
          return (
            <Pressable
              key={option.mode}
              style={[styles.option, selected && styles.optionSelected]}
              onPress={() => void setArtistGroupingMode(option.mode)}
              accessibilityRole="radio"
              accessibilityState={{ selected }}
            >
              <View style={styles.optionText}>
                <Text variant="body" color={selected ? colors.accentTextStrong : colors.textPrimary}>
                  {option.title}
                </Text>
                <Text variant="caption" color={colors.textSecondary} style={styles.optionDescription}>
                  {option.description}
                </Text>
              </View>
              {selected ? (
                <Ionicons name="checkmark-circle" size={20} color={colors.accent} />
              ) : (
                <Ionicons name="ellipse-outline" size={20} color={colors.textTertiary} />
              )}
            </Pressable>
          );
        })}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  heading: {
    marginTop: spacing.xl,
    marginBottom: spacing.xxl,
  },
  sectionLabel: {
    letterSpacing: 1,
    marginBottom: spacing.sm,
  },
  settingTitle: {
    marginBottom: spacing.xs,
  },
  settingNote: {
    marginBottom: spacing.md,
  },
  options: {
    gap: spacing.sm,
  },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.lg,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glassBorder,
    backgroundColor: colors.glassBg,
  },
  optionSelected: {
    borderColor: colors.accent,
    backgroundColor: colors.glassHighlight,
  },
  optionText: {
    flex: 1,
    gap: 2,
  },
  optionDescription: {
    lineHeight: 16,
  },
});

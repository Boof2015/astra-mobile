import { Pressable, StyleSheet, View } from 'react-native';
import { Text } from '@/components/Text';
import { colors, radius, spacing } from '@/theme';
import type { EQMode } from '@/types/audio';

const MODES: { key: EQMode; label: string }[] = [
  { key: 'parametric', label: 'Parametric' },
  { key: 'graphic', label: 'Graphic' },
];

/** Two-segment Parametric | Graphic control (ViewModeSwitcher styling, fixed row). */
export function EQModeSwitcher({
  value,
  onChange,
}: {
  value: EQMode;
  onChange: (mode: EQMode) => void;
}) {
  return (
    <View style={styles.row}>
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
            <Text variant="label" style={[styles.label, active && styles.labelActive]}>
              {mode.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  pill: {
    flex: 1,
    alignItems: 'center',
    backgroundColor: colors.glassBg,
    borderColor: colors.glassBorder,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.pill,
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

export default EQModeSwitcher;

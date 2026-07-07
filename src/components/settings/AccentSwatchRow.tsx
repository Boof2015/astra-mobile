import { Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '@/components/Text';
import { spacing } from '@/theme';
import { ACCENTS, ACCENT_IDS, type AccentId } from '@/theme/accents';
import { createThemedStyles, useColors } from '@/theme/themed';

const SWATCH_SIZE = 36;

interface AccentSwatchRowProps {
  value: AccentId;
  onChange: (id: AccentId) => void;
}

/** Circular accent swatches; the selected one gets a ring + checkmark. */
export function AccentSwatchRow({ value, onChange }: AccentSwatchRowProps) {
  const styles = useStyles();
  const colors = useColors();
  return (
    <View style={styles.wrap}>
      <View style={styles.row}>
        {ACCENT_IDS.map((id) => {
          const selected = id === value;
          return (
            <Pressable
              key={id}
              onPress={() => onChange(id)}
              accessibilityRole="radio"
              accessibilityState={{ selected }}
              accessibilityLabel={`${ACCENTS[id].label} accent`}
              style={[
                styles.swatch,
                { backgroundColor: ACCENTS[id].base },
                selected && styles.swatchSelected,
              ]}
              hitSlop={4}
            >
              {selected ? (
                <Ionicons name="checkmark" size={18} color={colors.bgPrimary} />
              ) : null}
            </Pressable>
          );
        })}
      </View>
      <Text variant="caption" color={colors.textSecondary}>
        Accent · {ACCENTS[value].label}
      </Text>
    </View>
  );
}

const useStyles = createThemedStyles((colors) => ({
  wrap: {
    gap: spacing.sm,
  },
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
  },
  swatch: {
    width: SWATCH_SIZE,
    height: SWATCH_SIZE,
    borderRadius: SWATCH_SIZE / 2,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glassBorder,
  },
  swatchSelected: {
    borderWidth: 2,
    borderColor: colors.textPrimary,
  },
}));

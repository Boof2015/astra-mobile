import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Canvas, LinearGradient, Rect, vec } from '@shopify/react-native-skia';
import { Text } from '@/components/Text';
import { spacing } from '@/theme';
import { ACCENTS, ACCENT_IDS, accentPreferenceBase } from '@/theme/accents';
import { createThemedStyles, useColors } from '@/theme/themed';
import { useRipple } from '@/theme/ripple';
import { playHaptic } from '@/lib/haptics';
import { useThemeStore } from '@/stores/themeStore';
import { AccentColorSheet } from '@/components/settings/AccentColorSheet';

const SWATCH_SIZE = 36;
const RAINBOW = ['#ff5c5c', '#ffb454', '#2dd4a0', '#00b3ff', '#9d7bff', '#ff6b9d'];

/** Circular accent swatches; the selected one gets a ring + checkmark. */
export function AccentSwatchRow() {
  const styles = useStyles();
  const ripple = useRipple();
  const colors = useColors();
  const [pickerOpen, setPickerOpen] = useState(false);
  const preference = useThemeStore((s) => s.accentPreference);
  const setAccent = useThemeStore((s) => s.setAccent);
  const setCustomAccent = useThemeStore((s) => s.setCustomAccent);
  const previewCustomAccent = useThemeStore((s) => s.previewCustomAccent);
  const initialHex = accentPreferenceBase(preference);
  return (
    <View style={styles.wrap}>
      <View style={styles.row}>
        {ACCENT_IDS.map((id) => {
          const selected = preference.kind === 'preset' && id === preference.id;
          return (
            <Pressable android_ripple={ripple.bounded}
              key={id}
              onPress={() => {
                if (selected) return;
                playHaptic('selection');
                void setAccent(id);
              }}
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
        <Pressable
          android_ripple={ripple.bounded}
          onPress={() => {
            playHaptic('selection');
            setPickerOpen(true);
          }}
          accessibilityRole="radio"
          accessibilityState={{ selected: preference.kind === 'custom' }}
          accessibilityLabel="Custom accent"
          style={[
            styles.swatch,
            preference.kind === 'custom' && { backgroundColor: preference.hex },
            preference.kind === 'custom' && styles.swatchSelected,
          ]}
          hitSlop={4}
        >
          {preference.kind !== 'custom' ? (
            <Canvas pointerEvents="none" style={StyleSheet.absoluteFill}>
              <Rect x={0} y={0} width={SWATCH_SIZE} height={SWATCH_SIZE}>
                <LinearGradient
                  start={vec(0, SWATCH_SIZE)}
                  end={vec(SWATCH_SIZE, 0)}
                  colors={RAINBOW}
                />
              </Rect>
            </Canvas>
          ) : null}
          {preference.kind === 'custom' ? (
            <Ionicons name="checkmark" size={18} color={colors.bgPrimary} />
          ) : (
            <Ionicons name="add" size={18} color="#ffffff" />
          )}
        </Pressable>
      </View>
      <Text variant="caption" color={colors.textSecondary}>
        Accent · {preference.kind === 'preset'
          ? ACCENTS[preference.id].label
          : `Custom ${preference.hex.toUpperCase()}`}
      </Text>
      {pickerOpen ? (
        <AccentColorSheet
          initialHex={initialHex}
          onPreview={previewCustomAccent}
          onApply={(hex) => void setCustomAccent(hex)}
          onClose={() => {
            previewCustomAccent(null);
            setPickerOpen(false);
          }}
        />
      ) : null}
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
    overflow: 'hidden',
  },
  swatchSelected: {
    borderWidth: 2,
    borderColor: colors.textPrimary,
  },
}));

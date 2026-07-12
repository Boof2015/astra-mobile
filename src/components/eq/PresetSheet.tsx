import { Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '@/components/Text';
import { spacing } from '@/theme';
import { useColors } from '@/theme/themed';
import { SCROLL_PRESS_DELAY, useRipple } from '@/theme/ripple';
import type { EQPreset } from '@/types/audio';
import {
  EqSheet,
  EqSheetItem,
  EqSheetSection
} from './EqSheet';

interface PresetSheetProps {
  presets: EQPreset[];
  activePresetId: string | null;
  onApply: (id: string) => void;
  onDelete: (id: string) => void;
  onSaveNew: () => void;
  onClose: () => void;
}

/**
 * Leading row icon telling a custom preset's editor mode apart at a glance.
 * Built-ins get no icon — they're mode-agnostic and apply in the active mode.
 */
function modeIcon(preset: EQPreset): 'options-outline' | 'analytics-outline' {
  return preset.mode === 'graphic' ? 'options-outline' : 'analytics-outline';
}

/** Preset hub: pick a built-in or custom preset, delete custom ones, or save a new one. */
export function PresetSheet({
  presets,
  activePresetId,
  onApply,
  onDelete,
  onSaveNew,
  onClose,
}: PresetSheetProps) {
  const colors = useColors();
  const ripple = useRipple();
  const builtIn = presets.filter((p) => !p.isCustom);
  const custom = presets.filter((p) => p.isCustom);

  return (
    <EqSheet onClose={onClose}>
      <Text variant="heading" style={styles.title}>
        Presets
      </Text>

      <EqSheetSection label="BUILT-IN" />
      {builtIn.map((p) => (
        <EqSheetItem
          key={p.id}
          label={p.name}
          selected={p.id === activePresetId}
          onPress={() => {
            onApply(p.id);
            onClose();
          }}
        />
      ))}

      <EqSheetSection label="CUSTOM" />
      {custom.length === 0 ? (
        <Text variant="caption" color={colors.textTertiary} style={styles.empty}>
          No saved presets yet.
        </Text>
      ) : (
        custom.map((p) => (
          <EqSheetItem
            key={p.id}
            label={p.name}
            icon={modeIcon(p)}
            selected={p.id === activePresetId}
            onPress={() => {
              onApply(p.id);
              onClose();
            }}
            trailing={
              <Pressable android_ripple={ripple.bounded} unstable_pressDelay={SCROLL_PRESS_DELAY}
                hitSlop={10}
                onPress={() => onDelete(p.id)}
                style={styles.delete}
                accessibilityLabel={`Delete preset ${p.name}`}
              >
                <Ionicons name="trash-outline" size={18} color={colors.textTertiary} />
              </Pressable>
            }
          />
        ))
      )}

      <EqSheetItem
        label="Save current as preset…"
        icon="bookmark-outline"
        onPress={() => {
          onClose();
          onSaveNew();
        }}
      />
    </EqSheet>
  );
}

const styles = StyleSheet.create({
  title: {
    marginTop: spacing.xs,
  },
  empty: {
    paddingVertical: spacing.sm,
  },
  delete: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
  },
});

export default PresetSheet;

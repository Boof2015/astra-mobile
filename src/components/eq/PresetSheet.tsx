import { Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '@/components/Text';
import { radius, spacing } from '@/theme';
import { useColors } from '@/theme/themed';
import { SCROLL_PRESS_DELAY, useRipple } from '@/theme/ripple';
import type { KnownEQOutputDevice } from '@/audio/eqDevicePresets';
import type { EQPreset } from '@/types/audio';
import {
  EqSheet,
  EqSheetItem,
  EqSheetSection
} from './EqSheet';

interface PresetSheetProps {
  presets: EQPreset[];
  activePresetId: string | null;
  knownDevices: KnownEQOutputDevice[];
  assignments: Readonly<Record<string, string>>;
  onApply: (id: string) => void;
  onAssign: (preset: EQPreset) => void;
  onDelete: (preset: EQPreset) => void;
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
  knownDevices,
  assignments,
  onApply,
  onAssign,
  onDelete,
  onSaveNew,
  onClose,
}: PresetSheetProps) {
  const colors = useColors();
  const ripple = useRipple();
  const builtIn = presets.filter((p) => !p.isCustom);
  const custom = presets.filter((p) => p.isCustom);
  const devicesByKey = new Map(knownDevices.map((device) => [device.key, device]));

  const renderPreset = (preset: EQPreset) => {
    const assignedDeviceKeys = Object.entries(assignments)
      .filter(([, presetId]) => presetId === preset.id)
      .map(([deviceKey]) => deviceKey);
    const assignmentSubtitle = assignedDeviceKeys.length === 1
      ? `Assigned to ${devicesByKey.get(assignedDeviceKeys[0])?.label ?? '1 device'}`
      : assignedDeviceKeys.length > 1
        ? `Assigned to ${assignedDeviceKeys.length} devices`
        : undefined;
    return (
      <EqSheetItem
        key={preset.id}
        label={preset.name}
        subtitle={assignmentSubtitle}
        icon={preset.isCustom ? modeIcon(preset) : undefined}
        selected={preset.id === activePresetId}
        onPress={() => {
          onApply(preset.id);
          onClose();
        }}
        trailing={
          <View style={styles.trailingActions}>
            <Pressable
              android_ripple={ripple.bounded}
              unstable_pressDelay={SCROLL_PRESS_DELAY}
              hitSlop={6}
              onPress={() => onAssign(preset)}
              style={styles.assignButton}
              accessibilityLabel={`Assign devices to ${preset.name}`}
            >
              <Text variant="label" color={colors.textSecondary}>
                Assign
              </Text>
              <Ionicons name="chevron-forward" size={14} color={colors.textTertiary} />
            </Pressable>
            {preset.isCustom ? (
              <Pressable
                android_ripple={ripple.bounded}
                unstable_pressDelay={SCROLL_PRESS_DELAY}
                hitSlop={8}
                onPress={() => onDelete(preset)}
                style={styles.deleteButton}
                accessibilityLabel={`Delete preset ${preset.name}`}
              >
                <Ionicons name="trash-outline" size={18} color={colors.textTertiary} />
              </Pressable>
            ) : null}
          </View>
        }
      />
    );
  };

  return (
    <EqSheet onClose={onClose} scrollable>
      <Text variant="heading" style={styles.title}>
        Presets
      </Text>

      <EqSheetSection label="BUILT-IN" />
      {builtIn.map(renderPreset)}

      <EqSheetSection label="CUSTOM" />
      {custom.length === 0 ? (
        <Text variant="caption" color={colors.textTertiary} style={styles.empty}>
          No saved presets yet.
        </Text>
      ) : (
        custom.map(renderPreset)
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
  trailingActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  assignButton: {
    minHeight: 40,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.pill,
    overflow: 'hidden',
  },
  deleteButton: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
  },
});

export default PresetSheet;

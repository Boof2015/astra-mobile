import { useState } from 'react';
import {
  Pressable,
  StyleSheet,
  View
} from 'react-native';
import { BottomSheetTextInput } from '@gorhom/bottom-sheet';
import { Text } from '@/components/Text';
import { HapticSwitch } from '@/components/HapticSwitch';
import {
  fonts,
  radius,
  spacing,
} from '@/theme';
import { createThemedStyles, useColors } from '@/theme/themed';
import { useRipple } from '@/theme/ripple';
import { EqSheet } from './EqSheet';

interface SavePresetSheetProps {
  defaultName: string;
  currentDeviceLabel?: string | null;
  onSave: (name: string, assignToCurrentDevice: boolean) => void;
  onClose: () => void;
}

/** Name + save a custom preset from the current bands/preamp. */
export function SavePresetSheet({
  defaultName,
  currentDeviceLabel,
  onSave,
  onClose,
}: SavePresetSheetProps) {
  const styles = useStyles();
  const ripple = useRipple();
  const colors = useColors();
  const [name, setName] = useState(defaultName);
  const [assignToCurrentDevice, setAssignToCurrentDevice] = useState(false);
  const trimmed = name.trim();

  return (
    <EqSheet onClose={onClose}>
      <Text variant="heading" style={styles.title}>
        Save preset
      </Text>
      <BottomSheetTextInput
        value={name}
        onChangeText={setName}
        placeholder="Preset name"
        placeholderTextColor={colors.textTertiary}
        style={styles.input}
        autoFocus
        selectTextOnFocus
        maxLength={40}
        returnKeyType="done"
        onSubmitEditing={() => {
          if (trimmed) {
            onSave(trimmed, assignToCurrentDevice);
            onClose();
          }
        }}
      />
      {currentDeviceLabel ? (
        <View style={styles.assignmentRow}>
          <View style={styles.assignmentText}>
            <Text variant="body">Assign to current output</Text>
            <Text variant="caption" color={colors.textSecondary} numberOfLines={1}>
              {currentDeviceLabel}
            </Text>
          </View>
          <HapticSwitch
            value={assignToCurrentDevice}
            onValueChange={setAssignToCurrentDevice}
            trackColor={{ false: colors.glassBorder, true: colors.accent }}
            thumbColor={colors.textPrimary}
          />
        </View>
      ) : null}
      <View style={styles.actions}>
        <Pressable android_ripple={ripple.bounded} style={[styles.btn, styles.cancel]} onPress={onClose}>
          <Text variant="label" color={colors.textSecondary}>
            Cancel
          </Text>
        </Pressable>
        <Pressable android_ripple={ripple.bounded}
          style={[styles.btn, styles.save, !trimmed && styles.saveDisabled]}
          disabled={!trimmed}
          onPress={() => {
            onSave(trimmed, assignToCurrentDevice);
            onClose();
          }}
        >
          <Text variant="label" color={colors.accentTextStrong}>
            Save
          </Text>
        </Pressable>
      </View>
    </EqSheet>
  );
}

const useStyles = createThemedStyles((colors) => ({
  title: {
    marginTop: spacing.xs,
    marginBottom: spacing.md,
  },
  input: {
    color: colors.textPrimary,
    fontFamily: fonts.sans.regular,
    fontSize: 16,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glassBorder,
    backgroundColor: colors.glassBg,
  },
  assignmentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginTop: spacing.md,
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glassBorder,
    backgroundColor: colors.glassBg,
  },
  assignmentText: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: spacing.sm,
    marginTop: spacing.lg,
  },
  btn: {
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
    borderRadius: radius.pill,
  },
  cancel: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glassBorder,
  },
  save: {
    backgroundColor: colors.accentGlow,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.accent,
  },
  saveDisabled: {
    opacity: 0.4,
  },
}));

export default SavePresetSheet;

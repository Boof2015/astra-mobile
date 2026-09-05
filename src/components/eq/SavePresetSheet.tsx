import { ActionButton } from '@/components/ActionButton';
import { useState } from 'react';
import {
  StyleSheet,
  View
} from 'react-native';
import { BottomSheetTextInput } from '@gorhom/bottom-sheet';
import { Text } from '@/components/Text';
import { HapticSwitch } from '@/components/HapticSwitch';
import { AppSheetBody, AppSheetField, AppSheetFooter, AppSheetTitle } from '@/components/sheets/AppSheet';
import {
  fonts,
  radius,
  spacing,
} from '@/theme';
import { createThemedStyles, useColors } from '@/theme/themed';
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
  const colors = useColors();
  const [name, setName] = useState(defaultName);
  const [assignToCurrentDevice, setAssignToCurrentDevice] = useState(false);
  const trimmed = name.trim();

  return (
    <EqSheet onClose={onClose} scrollable>
      <AppSheetTitle title="Save preset" />
      <AppSheetBody>
        <AppSheetField label="Preset name">
          <BottomSheetTextInput
            value={name}
            onChangeText={setName}
            placeholder="Preset name"
            accessibilityLabel="Preset name"
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
        </AppSheetField>
        {currentDeviceLabel ? (
          <View style={styles.assignmentRow}>
            <View style={styles.assignmentText}>
              <Text variant="body">Assign to current output</Text>
              <Text variant="caption" color={colors.textSecondary}>
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
      </AppSheetBody>
      <AppSheetFooter>
        <ActionButton
          onPress={onClose}
          variant="secondary"
          label="Cancel"
        />
        <ActionButton
          disabled={!trimmed}
          onPress={() => {
            onSave(trimmed, assignToCurrentDevice);
            onClose();
          }}
          variant="primary"
          label="Save"
        />
      </AppSheetFooter>
    </EqSheet>
  );
}

const useStyles = createThemedStyles((colors) => ({
  input: {
    color: colors.textPrimary,
    fontFamily: fonts.sans.regular,
    fontSize: 16,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    borderRadius: 14,
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
}));

export default SavePresetSheet;

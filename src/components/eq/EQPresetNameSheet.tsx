import { ActionButton } from '@/components/ActionButton';
import { useState } from 'react';
import { StyleSheet } from 'react-native';
import { BottomSheetTextInput } from '@gorhom/bottom-sheet';
import { AppSheetBody, AppSheetField, AppSheetFooter, AppSheetTitle } from '@/components/sheets/AppSheet';
import {
  fonts,
  spacing,
} from '@/theme';
import { createThemedStyles, useColors } from '@/theme/themed';
import { EqSheet } from './EqSheet';

interface EQPresetNameSheetProps {
  defaultName: string;
  actionLabel: string;
  onSubmit: (name: string) => void;
  onClose: () => void;
}

export function EQPresetNameSheet({
  defaultName,
  actionLabel,
  onSubmit,
  onClose,
}: EQPresetNameSheetProps) {
  const styles = useStyles();
  const colors = useColors();
  const [name, setName] = useState(defaultName);
  const trimmed = name.trim();

  const submit = () => {
    if (!trimmed) return;
    onClose();
    onSubmit(trimmed);
  };

  return (
    <EqSheet onClose={onClose} scrollable>
      <AppSheetTitle title="Name preset" />
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
            onSubmitEditing={submit}
          />
        </AppSheetField>
      </AppSheetBody>
      <AppSheetFooter>
        <ActionButton
          onPress={onClose}
          variant="secondary"
          label="Cancel"
        />
        <ActionButton
          disabled={!trimmed}
          onPress={submit}
          variant="primary"
          label={actionLabel}
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
}));

export default EQPresetNameSheet;

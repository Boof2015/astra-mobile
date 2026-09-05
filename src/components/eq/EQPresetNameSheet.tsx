import { actionButtonBase, actionButtonStyle, actionButtonTextStyle } from '@/theme/actionButtons';
import { useState } from 'react';
import {
  StyleSheet,
  View
} from 'react-native';
import { BottomSheetTextInput } from '@gorhom/bottom-sheet';
import { Text } from '@/components/Text';
import {
  fonts,
  radius,
  spacing,
} from '@/theme';
import { createThemedStyles, useColors } from '@/theme/themed';
import { AppPressable } from '@/components/AppPressable';
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
    <EqSheet onClose={onClose}>
      <Text variant="heading" style={styles.title}>
        Name preset
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
        onSubmitEditing={submit}
      />
      <View style={styles.actions}>
        <AppPressable feedback="control"  style={[styles.btn, styles.cancel]} onPress={onClose}>
          <Text style={actionButtonTextStyle(colors, 'secondary')} variant="label">
            Cancel
          </Text>
        </AppPressable>
        <AppPressable feedback="accent"  style={[styles.btn, styles.primary, !trimmed && styles.disabled]} disabled={!trimmed} onPress={submit}>
          <Text style={actionButtonTextStyle(colors, 'primary')} variant="label">
            {actionLabel}
          </Text>
        </AppPressable>
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
  actions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: spacing.sm,
    marginTop: spacing.lg,
  },
  btn: {
    ...actionButtonBase,
  },
  cancel: {
    ...actionButtonStyle(colors, 'secondary'),
  },
  primary: {
    ...actionButtonStyle(colors, 'primary'),
  },
  disabled: {
    opacity: 0.4,
  },
}));

export default EQPresetNameSheet;

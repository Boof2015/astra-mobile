import { ActionButton } from '@/components/ActionButton';
import { useState } from 'react';
import {
  StyleSheet,
  View,
  type KeyboardTypeOptions
} from 'react-native';
import { BottomSheetTextInput } from '@gorhom/bottom-sheet';
import { Text } from '@/components/Text';
import { AppSheetBody, AppSheetFooter, AppSheetTitle } from '@/components/sheets/AppSheet';
import {
  fonts,
  spacing,
} from '@/theme';
import { createThemedStyles, useColors } from '@/theme/themed';
import { EqSheet } from './EqSheet';

interface EQValueEditSheetProps {
  title: string;
  initialValue: string;
  unit: string;
  rangeLabel: string;
  placeholder?: string;
  keyboardType?: KeyboardTypeOptions;
  parseValue: (value: string) => number | null;
  onApply: (value: number) => void;
  onClose: () => void;
}

/** Focused numeric editor for exact EQ band values. */
export function EQValueEditSheet({
  title,
  initialValue,
  unit,
  rangeLabel,
  placeholder,
  keyboardType = 'numbers-and-punctuation',
  parseValue,
  onApply,
  onClose,
}: EQValueEditSheetProps) {
  const styles = useStyles();
  const colors = useColors();
  const [value, setValue] = useState(initialValue);
  const trimmed = value.trim();
  const parsed = trimmed.length > 0 ? parseValue(trimmed) : null;
  const valid = parsed !== null;

  const apply = () => {
    if (parsed === null) return;
    onApply(parsed);
    onClose();
  };

  return (
    <EqSheet onClose={onClose} scrollable>
      <AppSheetTitle title={title} />
      <AppSheetBody>
        <View style={styles.inputRow}>
          <BottomSheetTextInput
            value={value}
            accessibilityLabel={title}
            onChangeText={setValue}
            placeholder={placeholder}
            placeholderTextColor={colors.textTertiary}
            keyboardType={keyboardType}
            style={[styles.input, trimmed.length > 0 && !valid && styles.inputInvalid]}
            autoFocus
            selectTextOnFocus
            maxLength={16}
            returnKeyType="done"
            onSubmitEditing={apply}
            selectionColor={colors.accent}
          />
          <Text variant="label" style={styles.unit}>
            {unit}
          </Text>
        </View>
        <Text variant="caption" style={[styles.range, trimmed.length > 0 && !valid && styles.invalidText]}>
          {valid || trimmed.length === 0 ? rangeLabel : 'Enter a valid number'}
        </Text>
      </AppSheetBody>
      <AppSheetFooter>
        <ActionButton
          onPress={onClose}
          variant="secondary"
          label="Cancel"
        />
        <ActionButton
          disabled={!valid}
          onPress={apply}
          variant="primary"
          label="Apply"
        />
      </AppSheetFooter>
    </EqSheet>
  );
}

const useStyles = createThemedStyles((colors) => ({
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  input: {
    flex: 1,
    color: colors.textPrimary,
    fontFamily: fonts.mono.regular,
    fontSize: 18,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glassBorder,
    backgroundColor: colors.glassBg,
  },
  inputInvalid: {
    borderColor: colors.warning,
  },
  unit: {
    minWidth: 34,
    color: colors.textSecondary,
  },
  range: {
    marginTop: spacing.sm,
    color: colors.textTertiary,
  },
  invalidText: {
    color: colors.warning,
  },
}));

export default EQValueEditSheet;

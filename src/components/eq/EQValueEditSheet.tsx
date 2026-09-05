import { ActionButton } from '@/components/ActionButton';
import { useState } from 'react';
import {
  View,
  type KeyboardTypeOptions
} from 'react-native';
import { BottomSheetTextInput } from '@gorhom/bottom-sheet';
import { Ionicons } from '@expo/vector-icons';
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
  invalidMessage: string;
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
  invalidMessage,
  placeholder,
  keyboardType = 'numbers-and-punctuation',
  parseValue,
  onApply,
  onClose,
}: EQValueEditSheetProps) {
  const styles = useStyles();
  const colors = useColors();
  const [value, setValue] = useState(initialValue);
  const [focused, setFocused] = useState(false);
  const trimmed = value.trim();
  const parsed = trimmed.length > 0 ? parseValue(trimmed) : null;
  const valid = parsed !== null;
  const invalid = trimmed.length > 0 && !valid;

  const apply = () => {
    if (parsed === null) return;
    onApply(parsed);
    onClose();
  };

  return (
    <EqSheet onClose={onClose} scrollable>
      <AppSheetTitle title={title} />
      <AppSheetBody>
        <View style={[styles.inputRow, focused && styles.inputFocused, invalid && styles.inputInvalid]}>
          <BottomSheetTextInput
            value={value}
            accessibilityLabel={title}
            accessibilityHint={invalid ? invalidMessage : rangeLabel}
            onChangeText={setValue}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            placeholder={placeholder}
            placeholderTextColor={colors.textSecondary}
            keyboardType={keyboardType}
            style={styles.input}
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
        <View style={styles.hintRow}>
          {invalid ? (
            <Ionicons name="alert-circle-outline" size={16} color={colors.warning} accessible={false} />
          ) : null}
          <Text
            variant="caption"
            style={[styles.range, invalid && styles.invalidText]}
            accessibilityLiveRegion="polite"
          >
            {invalid ? invalidMessage : rangeLabel}
          </Text>
        </View>
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
    minHeight: 48,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.glassBorder,
    backgroundColor: colors.bgTertiary,
  },
  input: {
    flex: 1,
    minWidth: 0,
    color: colors.textPrimary,
    fontFamily: fonts.mono.regular,
    fontSize: 18,
    lineHeight: 24,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
  },
  inputFocused: {
    borderColor: colors.accent,
  },
  inputInvalid: {
    borderColor: colors.warning,
  },
  unit: {
    paddingRight: spacing.md,
    color: colors.textSecondary,
  },
  hintRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.xs + 2,
    marginTop: spacing.sm,
  },
  range: {
    flex: 1,
    lineHeight: 16,
    color: colors.textSecondary,
  },
  invalidText: {
    color: colors.warning,
  },
}));

export default EQValueEditSheet;

import { useState } from 'react';
import {
  Pressable,
  StyleSheet,
  View,
  type KeyboardTypeOptions
} from 'react-native';
import { BottomSheetTextInput } from '@gorhom/bottom-sheet';
import { Text } from '@/components/Text';
import {
  colors,
  fonts,
  radius,
  spacing
} from '@/theme';
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
    <EqSheet onClose={onClose}>
      <Text variant="heading" style={styles.title}>
        {title}
      </Text>
      <View style={styles.inputRow}>
        <BottomSheetTextInput
          value={value}
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
      <View style={styles.actions}>
        <Pressable style={[styles.btn, styles.cancel]} onPress={onClose}>
          <Text variant="label" color={colors.textSecondary}>
            Cancel
          </Text>
        </Pressable>
        <Pressable
          style={[styles.btn, styles.apply, !valid && styles.applyDisabled]}
          disabled={!valid}
          onPress={apply}
        >
          <Text variant="label" color={colors.accentTextStrong}>
            Apply
          </Text>
        </Pressable>
      </View>
    </EqSheet>
  );
}

const styles = StyleSheet.create({
  title: {
    marginTop: spacing.xs,
    marginBottom: spacing.md,
  },
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
    borderRadius: radius.md,
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
  apply: {
    backgroundColor: colors.accentGlow,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.accent,
  },
  applyDisabled: {
    opacity: 0.4,
  },
});

export default EQValueEditSheet;

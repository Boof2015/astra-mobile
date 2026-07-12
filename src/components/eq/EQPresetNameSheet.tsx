import { useState } from 'react';
import {
  Pressable,
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
import { useRipple } from '@/theme/ripple';
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
  const ripple = useRipple();
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
        <Pressable android_ripple={ripple.bounded} style={[styles.btn, styles.cancel]} onPress={onClose}>
          <Text variant="label" color={colors.textSecondary}>
            Cancel
          </Text>
        </Pressable>
        <Pressable android_ripple={ripple.bounded} style={[styles.btn, styles.primary, !trimmed && styles.disabled]} disabled={!trimmed} onPress={submit}>
          <Text variant="label" color={colors.accentTextStrong}>
            {actionLabel}
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
  primary: {
    backgroundColor: colors.accentGlow,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.accent,
  },
  disabled: {
    opacity: 0.4,
  },
}));

export default EQPresetNameSheet;

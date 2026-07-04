import { useState } from 'react';
import {
  Pressable,
  StyleSheet,
  View
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

interface SavePresetSheetProps {
  defaultName: string;
  onSave: (name: string) => void;
  onClose: () => void;
}

/** Name + save a custom preset from the current bands/preamp. */
export function SavePresetSheet({ defaultName, onSave, onClose }: SavePresetSheetProps) {
  const [name, setName] = useState(defaultName);
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
            onSave(trimmed);
            onClose();
          }
        }}
      />
      <View style={styles.actions}>
        <Pressable style={[styles.btn, styles.cancel]} onPress={onClose}>
          <Text variant="label" color={colors.textSecondary}>
            Cancel
          </Text>
        </Pressable>
        <Pressable
          style={[styles.btn, styles.save, !trimmed && styles.saveDisabled]}
          disabled={!trimmed}
          onPress={() => {
            onSave(trimmed);
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

const styles = StyleSheet.create({
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
  save: {
    backgroundColor: colors.accentGlow,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.accent,
  },
  saveDisabled: {
    opacity: 0.4,
  },
});

export default SavePresetSheet;

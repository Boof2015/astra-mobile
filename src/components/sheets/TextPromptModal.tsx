import { useState } from 'react';
import {
  Modal,
  Pressable,
  StyleSheet,
  TextInput,
  View
} from 'react-native';
import { Text } from '@/components/Text';
import {
  fonts,
  fontSize,
  radius,
  spacing,
} from '@/theme';
import { createThemedStyles, useColors } from '@/theme/themed';
import { useRipple } from '@/theme/ripple';

interface TextPromptModalProps {
  visible: boolean;
  title: string;
  placeholder?: string;
  initialValue?: string;
  submitLabel?: string;
  onSubmit: (value: string) => void;
  onClose: () => void;
}

/** Text input prompt (RN's Alert.prompt is iOS-only). */
export function TextPromptModal(props: TextPromptModalProps) {
  // Mount the inner component fresh per open so the input state resets.
  if (!props.visible) return null;
  return <TextPromptModalInner {...props} />;
}

function TextPromptModalInner({
  title,
  placeholder,
  initialValue = '',
  submitLabel = 'Save',
  onSubmit,
  onClose,
}: TextPromptModalProps) {
  const styles = useStyles();
  const ripple = useRipple();
  const colors = useColors();
  const [value, setValue] = useState(initialValue);
  const trimmed = value.trim();

  const submit = () => {
    if (!trimmed) return;
    onSubmit(trimmed);
  };

  return (
    <Modal visible transparent animationType="fade" statusBarTranslucent onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityRole="button">
        <Pressable style={styles.card}>
          <Text variant="heading" style={styles.title}>
            {title}
          </Text>
          <TextInput
            style={styles.input}
            value={value}
            onChangeText={setValue}
            placeholder={placeholder}
            placeholderTextColor={colors.textTertiary}
            autoFocus
            returnKeyType="done"
            onSubmitEditing={submit}
            selectionColor={colors.accent}
          />
          <View style={styles.actions}>
            <Pressable android_ripple={ripple.bounded} style={styles.action} onPress={onClose} accessibilityRole="button">
              <Text variant="body" color={colors.textSecondary}>
                Cancel
              </Text>
            </Pressable>
            <Pressable android_ripple={ripple.bounded}
              style={[styles.action, !trimmed && styles.actionDisabled]}
              disabled={!trimmed}
              onPress={submit}
              accessibilityRole="button"
            >
              <Text variant="body" color={colors.accent}>
                {submitLabel}
              </Text>
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const useStyles = createThemedStyles((colors) => ({
  backdrop: {
    flex: 1,
    backgroundColor: colors.backdrop,
    justifyContent: 'center',
    padding: spacing.xl,
  },
  card: {
    backgroundColor: colors.bgSecondary,
    borderRadius: radius.lg,
    borderColor: colors.glassBorder,
    borderWidth: StyleSheet.hairlineWidth,
    padding: spacing.lg,
    gap: spacing.md,
  },
  title: {
    fontSize: fontSize.base,
  },
  input: {
    fontFamily: fonts.sans.regular,
    fontSize: fontSize.base,
    color: colors.textPrimary,
    backgroundColor: colors.bgTertiary,
    borderColor: colors.glassBorder,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: spacing.sm,
  },
  action: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  actionDisabled: {
    opacity: 0.4,
  },
}));

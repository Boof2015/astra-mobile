import {
  Modal,
  Pressable,
  StyleSheet,
  View
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Text } from '@/components/Text';
import {
  radius,
  spacing,
} from '@/theme';
import { createThemedStyles, useColors } from '@/theme/themed';
import { SCROLL_PRESS_DELAY, useRipple } from '@/theme/ripple';

export interface ActionSheetItem {
  key: string;
  label: string;
  icon?: keyof typeof Ionicons.glyphMap;
  destructive?: boolean;
  selected?: boolean;
  onPress: () => void;
}

/**
 * Bottom action sheet on a plain RN Modal. Item presses do NOT auto-close —
 * the consumer decides (allows multi-step flows like add-to-playlist).
 */
export function ActionSheet({
  visible,
  title,
  items,
  onClose,
}: {
  visible: boolean;
  title?: string;
  items: ActionSheetItem[];
  onClose: () => void;
}) {
  const styles = useStyles();
  const colors = useColors();
  const ripple = useRipple();
  const insets = useSafeAreaInsets();

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      statusBarTranslucent
      onRequestClose={onClose}
    >
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityRole="button">
        <Pressable style={[styles.card, { paddingBottom: insets.bottom + spacing.md }]}>
          <View style={styles.grabber} />
          {title ? (
            <Text variant="label" numberOfLines={1} style={styles.title}>
              {title}
            </Text>
          ) : null}
          {items.map((item) => (
            <Pressable
              key={item.key}
              android_ripple={ripple.bounded} unstable_pressDelay={SCROLL_PRESS_DELAY}
              style={styles.item}
              onPress={item.onPress}
              accessibilityRole="button"
            >
              {item.icon ? (
                <Ionicons
                  name={item.icon}
                  size={20}
                  color={item.destructive ? colors.warning : colors.textSecondary}
                />
              ) : null}
              <Text
                variant="body"
                numberOfLines={1}
                style={styles.itemLabel}
                color={item.destructive ? colors.warning : undefined}
              >
                {item.label}
              </Text>
              {item.selected ? (
                <Ionicons name="checkmark" size={18} color={colors.accent} />
              ) : null}
            </Pressable>
          ))}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const useStyles = createThemedStyles((colors) => ({
  backdrop: {
    flex: 1,
    backgroundColor: colors.backdrop,
    justifyContent: 'flex-end',
  },
  card: {
    backgroundColor: colors.bgSecondary,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    borderColor: colors.glassBorder,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
  },
  grabber: {
    alignSelf: 'center',
    width: 36,
    height: 4,
    borderRadius: radius.pill,
    backgroundColor: colors.glassBorder,
    marginBottom: spacing.sm,
  },
  title: {
    marginBottom: spacing.xs,
  },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
  },
  itemLabel: {
    flex: 1,
  },
}));

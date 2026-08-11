import { useSyncExternalStore } from 'react';
import {
  Modal,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { Text } from '@/components/Text';
import { radius, spacing } from '@/theme';
import { createThemedStyles, useColors } from '@/theme/themed';
import { AppPressable } from '@/components/AppPressable';
import {
  dismissActiveDialog,
  EMPTY_DIALOG_QUEUE,
  enqueueDialog,
  normalizeDialog,
  takeActiveDialogAction,
  type AppDialogOptions,
  type AppDialogQueueState,
} from './dialogQueue';

let nextDialogId = 1;
let dialogQueue: AppDialogQueueState = EMPTY_DIALOG_QUEUE;
const listeners = new Set<() => void>();

function emitChange() {
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot() {
  return dialogQueue;
}

function closeDialog(expectedId: number): boolean {
  const result = dismissActiveDialog(dialogQueue, expectedId);
  if (!result.dismissed) return false;
  dialogQueue = result.state;
  emitChange();
  return true;
}

function chooseDialogAction(expectedId: number, actionIndex: number) {
  const result = takeActiveDialogAction(dialogQueue, expectedId, actionIndex);
  if (!result.action) return null;
  dialogQueue = result.state;
  emitChange();
  return result.action;
}

export function showAppDialog(options: AppDialogOptions): void {
  const dialog = normalizeDialog(options, nextDialogId);
  nextDialogId += 1;
  dialogQueue = enqueueDialog(dialogQueue, dialog);
  emitChange();
}

export function AppDialogHost() {
  const queue = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const active = queue.active;
  const styles = useStyles();
  const colors = useColors();

  if (!active) return null;

  const selectAction = (actionIndex: number) => {
    const action = chooseDialogAction(active.id, actionIndex);
    action?.onPress?.();
  };

  const dismiss = () => {
    closeDialog(active.id);
  };

  return (
    <Modal
      visible
      transparent
      animationType="fade"
      statusBarTranslucent
      navigationBarTranslucent
      onRequestClose={dismiss}
    >
      <View style={styles.backdrop}>
        <View
          style={styles.card}
          accessibilityViewIsModal
          importantForAccessibility="yes"
          onAccessibilityEscape={dismiss}
        >
          <ScrollView
            style={styles.scroll}
            bounces={false}
            showsVerticalScrollIndicator={false}
            contentContainerStyle={styles.content}
          >
            <Text variant="heading" accessibilityRole="header">
              {active.title}
            </Text>
            {active.message ? (
              <Text variant="body" color={colors.textSecondary} style={styles.message}>
                {active.message}
              </Text>
            ) : null}
          </ScrollView>
          <View style={styles.actions}>
            {active.actions.map((action, index) => {
              const destructive = action.role === 'destructive';
              const secondary = action.role === 'cancel';
              const color = destructive
                ? colors.warning
                : secondary
                  ? colors.textSecondary
                  : colors.accent;
              return (
                <AppPressable feedback="none"
                  key={`${action.label}-${index}`}

                  style={({ pressed }) => [
                    styles.action,
                    pressed ? styles.actionPressed : null,
                  ]}
                  onPress={() => selectAction(index)}
                  accessibilityRole="button"
                  accessibilityLabel={action.label}
                >
                  <Text variant="body" color={color}>
                    {action.label}
                  </Text>
                </AppPressable>
              );
            })}
          </View>
        </View>
      </View>
    </Modal>
  );
}

export type {
  AppDialogAction,
  AppDialogActionRole,
  AppDialogOptions,
} from './dialogQueue';

const useStyles = createThemedStyles((colors) => ({
  backdrop: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.backdrop,
    padding: spacing.xl,
  },
  card: {
    width: '100%',
    maxWidth: 400,
    maxHeight: '80%',
    backgroundColor: colors.bgSecondary,
    borderRadius: radius.lg,
    borderColor: colors.glassBorder,
    borderWidth: StyleSheet.hairlineWidth,
    padding: spacing.lg,
    gap: spacing.md,
  },
  content: {
    gap: spacing.md,
  },
  scroll: {
    flexShrink: 1,
  },
  message: {
    lineHeight: 21,
  },
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'flex-end',
    gap: spacing.sm,
  },
  action: {
    minWidth: 72,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    overflow: 'hidden',
  },
  actionPressed: {
    backgroundColor: colors.glassHighlight,
  },
}));

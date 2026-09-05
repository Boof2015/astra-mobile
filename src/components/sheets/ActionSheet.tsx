import { Modal, StyleSheet } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { AppSheet, AppSheetItem, AppSheetTitle, type AppSheetItemProps } from './AppSheet';

export interface ActionSheetItem extends Omit<AppSheetItemProps, 'trailing' | 'stackActionsOnCompact'> {
  key: string;
}

/** Modal-hosted menu using the shared sheet; callers still own each action's dismissal. */
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
  if (!visible) return null;

  return (
    <Modal visible transparent animationType="none" statusBarTranslucent onRequestClose={onClose}>
      <GestureHandlerRootView style={styles.root}>
        <AppSheet onClose={onClose} scrollable>
          {title ? <AppSheetTitle title={title} /> : null}
          {items.map(({ key, ...item }) => <AppSheetItem key={key} {...item} />)}
        </AppSheet>
      </GestureHandlerRootView>
    </Modal>
  );
}

const styles = StyleSheet.create({ root: { flex: 1 } });

import { useCallback, type ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import BottomSheet, {
  BottomSheetBackdrop,
  BottomSheetView,
  type BottomSheetBackdropProps,
} from '@gorhom/bottom-sheet';
import { Text } from '@/components/Text';
import { colors, radius, spacing } from '@/theme';

/**
 * Bottom sheet for the EQ screen's menus — same chrome/behaviour as the now-playing
 * QueueTray (inline gorhom BottomSheet, dimmed backdrop, grab handle, pan-to-close)
 * so trays stay consistent across the app. Dynamically sized to its content; render
 * it conditionally ({open && <EqSheet onClose=...>}).
 */
export function EqSheet({ onClose, children }: { onClose: () => void; children: ReactNode }) {
  const insets = useSafeAreaInsets();
  const renderBackdrop = useCallback(
    (props: BottomSheetBackdropProps) => (
      <BottomSheetBackdrop
        {...props}
        appearsOnIndex={0}
        disappearsOnIndex={-1}
        pressBehavior="close"
        opacity={0.58}
      />
    ),
    []
  );

  return (
    <BottomSheet
      index={0}
      enableDynamicSizing
      enablePanDownToClose
      onClose={onClose}
      backdropComponent={renderBackdrop}
      backgroundStyle={styles.sheetBg}
      handleIndicatorStyle={styles.handle}
    >
      <BottomSheetView style={[styles.content, { paddingBottom: insets.bottom + spacing.md }]}>
        {children}
      </BottomSheetView>
    </BottomSheet>
  );
}

/** Section label inside a sheet. */
export function EqSheetSection({ label }: { label: string }) {
  return (
    <Text variant="caption" style={styles.section}>
      {label}
    </Text>
  );
}

interface EqSheetItemProps {
  label: string;
  icon?: keyof typeof Ionicons.glyphMap;
  selected?: boolean;
  destructive?: boolean;
  onPress: () => void;
  /** Optional trailing control (e.g. a delete button). */
  trailing?: ReactNode;
}

/** One tappable row, styled like the ActionSheet items it replaces. */
export function EqSheetItem({ label, icon, selected, destructive, onPress, trailing }: EqSheetItemProps) {
  const tint = destructive ? colors.warning : selected ? colors.accentTextStrong : colors.textPrimary;
  return (
    <View style={styles.itemRow}>
      <Pressable
        style={({ pressed }) => [styles.item, pressed && styles.itemPressed]}
        onPress={onPress}
        accessibilityRole="button"
      >
        {icon ? (
          <Ionicons name={icon} size={20} color={destructive ? colors.warning : colors.textSecondary} />
        ) : null}
        <Text variant="body" numberOfLines={1} style={styles.itemLabel} color={tint}>
          {label}
        </Text>
        {selected ? <Ionicons name="checkmark" size={18} color={colors.accent} /> : null}
      </Pressable>
      {trailing}
    </View>
  );
}

const styles = StyleSheet.create({
  sheetBg: {
    backgroundColor: colors.bgSecondary,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
  },
  handle: {
    backgroundColor: colors.glassBorder,
    width: 38,
  },
  content: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xs,
  },
  section: {
    color: colors.textTertiary,
    letterSpacing: 1,
    marginTop: spacing.md,
    marginBottom: spacing.xs,
  },
  itemRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  item: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
  },
  itemPressed: {
    opacity: 0.6,
  },
  itemLabel: {
    flex: 1,
  },
});

export default EqSheet;

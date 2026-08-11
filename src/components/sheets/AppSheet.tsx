import { useCallback, type ReactNode } from 'react';
import {
  View
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Pressable as GesturePressable } from 'react-native-gesture-handler';
import BottomSheet, {
  BottomSheetBackdrop,
  BottomSheetScrollView,
  BottomSheetView,
  type BottomSheetBackdropProps
} from '@gorhom/bottom-sheet';
import { Text } from '@/components/Text';
import {
  radius,
  spacing,
} from '@/theme';
import { createThemedStyles, useColors } from '@/theme/themed';
import { SCROLL_PRESS_DELAY } from '@/components/AppPressable';
import { playHaptic } from '@/lib/haptics';
import { useSceneBottomInset } from '@/navigation/useShellLayout';

export function AppSheet({
  onClose,
  children,
  scrollable = false,
}: {
  onClose: () => void;
  children: ReactNode;
  scrollable?: boolean;
}) {
  const styles = useStyles();
  const insets = useSafeAreaInsets();
  const sceneBottomInset = useSceneBottomInset();
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
      {scrollable ? (
        <BottomSheetScrollView
          contentContainerStyle={[styles.content, { paddingBottom: Math.max(insets.bottom, sceneBottomInset) + spacing.md }]}
          showsVerticalScrollIndicator={false}
        >
          {children}
        </BottomSheetScrollView>
      ) : (
        <BottomSheetView
          style={[styles.content, { paddingBottom: Math.max(insets.bottom, sceneBottomInset) + spacing.md }]}
        >
          {children}
        </BottomSheetView>
      )}
    </BottomSheet>
  );
}

export function AppSheetSection({ label }: { label: string }) {
  const styles = useStyles();
  return (
    <Text variant="caption" style={styles.section}>
      {label}
    </Text>
  );
}

export function AppSheetTitle({ title, subtitle }: { title: string; subtitle?: string }) {
  const styles = useStyles();
  const colors = useColors();
  return (
    <View style={styles.titleBlock}>
      <Text variant="heading" numberOfLines={1} style={styles.title}>
        {title}
      </Text>
      {subtitle ? (
        <Text variant="label" numberOfLines={1} color={colors.textSecondary}>
          {subtitle}
        </Text>
      ) : null}
    </View>
  );
}

export interface AppSheetItemProps {
  label: string;
  subtitle?: string;
  icon?: keyof typeof Ionicons.glyphMap;
  selected?: boolean;
  destructive?: boolean;
  onPress: () => void;
  trailing?: ReactNode;
}

export function AppSheetItem({
  label,
  subtitle,
  icon,
  selected,
  destructive,
  onPress,
  trailing,
}: AppSheetItemProps) {
  const styles = useStyles();
  const colors = useColors();
  const tint = destructive ? colors.warning : selected ? colors.accentTextStrong : colors.textPrimary;
  const selectable = selected !== undefined;

  const handlePress = () => {
    if (selectable && !selected) playHaptic('selection');
    onPress();
  };

  return (
    <View style={styles.itemRow}>
      {/*
        This must participate in Gesture Handler's native arbitration. A core
        Pressable works in a fresh sheet, but after the Library dock has owned
        several horizontal pans BottomSheetScrollView can keep winning every
        later contact, leaving the row visibly tapped but never pressed.
      */}
      <GesturePressable
        unstable_pressDelay={SCROLL_PRESS_DELAY}
        style={({ pressed }) => [styles.item, pressed && styles.itemPressed]}
        onPress={handlePress}
        accessibilityRole={selectable ? 'radio' : 'button'}
        accessibilityState={selectable ? { selected } : undefined}
      >
        {icon ? (
          <Ionicons name={icon} size={20} color={destructive ? colors.warning : colors.textSecondary} />
        ) : null}
        <View style={styles.itemMeta}>
          <Text variant="body" numberOfLines={1} style={styles.itemLabel} color={tint}>
            {label}
          </Text>
          {subtitle ? (
            <Text variant="caption" numberOfLines={1} color={colors.textSecondary}>
              {subtitle}
            </Text>
          ) : null}
        </View>
        {selected ? <Ionicons name="checkmark" size={18} color={colors.accent} /> : null}
      </GesturePressable>
      {trailing}
    </View>
  );
}

const useStyles = createThemedStyles((colors) => ({
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
  titleBlock: {
    marginTop: spacing.xs,
    marginBottom: spacing.sm,
    gap: 2,
  },
  title: {
    paddingRight: spacing.lg,
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
    backgroundColor: colors.glassHighlight,
  },
  itemLabel: {
    flexShrink: 1,
  },
  itemMeta: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
}));

export default AppSheet;

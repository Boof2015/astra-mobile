import { useCallback, type ReactNode } from 'react';
import {
  Pressable,
  View
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import BottomSheet, {
  BottomSheetBackdrop,
  BottomSheetView,
  type BottomSheetBackdropProps
} from '@gorhom/bottom-sheet';
import { Text } from '@/components/Text';
import {
  radius,
  spacing,
} from '@/theme';
import { createThemedStyles, useColors } from '@/theme/themed';

export function AppSheet({ onClose, children }: { onClose: () => void; children: ReactNode }) {
  const styles = useStyles();
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
  icon?: keyof typeof Ionicons.glyphMap;
  selected?: boolean;
  destructive?: boolean;
  onPress: () => void;
  trailing?: ReactNode;
}

export function AppSheetItem({
  label,
  icon,
  selected,
  destructive,
  onPress,
  trailing,
}: AppSheetItemProps) {
  const styles = useStyles();
  const colors = useColors();
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
    opacity: 0.6,
  },
  itemLabel: {
    flex: 1,
  },
}));

export default AppSheet;

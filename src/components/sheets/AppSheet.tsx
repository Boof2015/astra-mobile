import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';
import { StyleSheet, View, useWindowDimensions, type LayoutChangeEvent, type ViewProps } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import BottomSheet, {
  BottomSheetBackdrop,
  BottomSheetScrollView,
  BottomSheetView,
  type BottomSheetBackdropProps
} from '@gorhom/bottom-sheet';
import { Text } from '@/components/Text';
import {
  spacing,
} from '@/theme';
import { createThemedStyles, useColors } from '@/theme/themed';
import { mixHex } from '@/theme/colorUtils';
import {
  AppPressable,
  AppPressableGestureScope,
  SCROLL_PRESS_DELAY,
} from '@/components/AppPressable';
import { playHaptic } from '@/lib/haptics';
import { useSceneBottomInset } from '@/navigation/useShellLayout';

// Measure once per sheet, including sheets hosted inside a narrower player pane.
const CompactSheetContext = createContext(false);

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
  const { width } = useWindowDimensions();
  const [measuredCompact, setMeasuredCompact] = useState<boolean | null>(null);
  const onContentLayout = useCallback((event: LayoutChangeEvent) => {
    setMeasuredCompact(event.nativeEvent.layout.width <= 360);
  }, []);
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
      <CompactSheetContext.Provider value={measuredCompact ?? width <= 360}>
        {scrollable ? (
          <BottomSheetScrollView
            onLayout={onContentLayout}
            contentContainerStyle={[styles.content, { paddingBottom: Math.max(insets.bottom, sceneBottomInset) + spacing.md }]}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
          >
            <AppPressableGestureScope>{children}</AppPressableGestureScope>
          </BottomSheetScrollView>
        ) : (
          <BottomSheetView
            onLayout={onContentLayout}
            style={[styles.content, { paddingBottom: Math.max(insets.bottom, sceneBottomInset) + spacing.md }]}
          >
            <AppPressableGestureScope>{children}</AppPressableGestureScope>
          </BottomSheetView>
        )}
      </CompactSheetContext.Provider>
    </BottomSheet>
  );
}

export function AppSheetSection({ label, first = false }: { label: string; first?: boolean }) {
  const styles = useStyles();
  return (
    <Text variant="caption" style={[styles.section, first && styles.firstSection]}>
      {label}
    </Text>
  );
}

export function AppSheetTitle({ title, subtitle }: { title: string; subtitle?: string }) {
  const styles = useStyles();
  const colors = useColors();
  return (
    <View style={styles.titleBlock}>
      <Text variant="heading">
        {title}
      </Text>
      {subtitle ? (
        <Text variant="label" color={colors.textSecondary}>
          {subtitle}
        </Text>
      ) : null}
    </View>
  );
}

/** Shared insets for form content, aligned with headers and menu icons. */
export function AppSheetBody({ style, ...props }: ViewProps) {
  const styles = useStyles();
  return <View {...props} style={[styles.body, style]} />;
}

export function AppSheetField({ label, children }: { label: string; children: ReactNode }) {
  const styles = useStyles();
  return (
    <View>
      <Text variant="label" style={styles.fieldLabel}>{label}</Text>
      {children}
    </View>
  );
}

export function AppSheetFooter({ style, ...props }: ViewProps) {
  const styles = useStyles();
  return <View {...props} style={[styles.footer, style]} />;
}

export function AppSheetDivider() {
  const styles = useStyles();
  return <View style={styles.divider} />;
}

export interface AppSheetItemProps {
  label: string;
  subtitle?: string;
  icon?: keyof typeof Ionicons.glyphMap;
  selected?: boolean;
  destructive?: boolean;
  disabled?: boolean;
  onPress: () => void;
  trailing?: ReactNode;
  /** Keep secondary actions distinct and readable in compact preset rows. */
  stackActionsOnCompact?: boolean;
}

export function AppSheetItem({
  label,
  subtitle,
  icon,
  selected,
  destructive,
  disabled = false,
  onPress,
  trailing,
  stackActionsOnCompact = false,
}: AppSheetItemProps) {
  const styles = useStyles();
  const colors = useColors();
  const compact = useContext(CompactSheetContext);
  const tint = destructive ? colors.warning : selected ? colors.accentTextStrong : colors.textPrimary;
  const selectable = selected !== undefined;
  const stackedActions = !!trailing && stackActionsOnCompact && compact;

  const handlePress = () => {
    if (selectable && !selected) playHaptic('selection');
    onPress();
  };

  return (
    <View style={[
      styles.itemRow,
      selected && styles.selectedRow,
      !!trailing && styles.rowWithActions,
      stackedActions && styles.stackedRow,
    ]}>
      <AppPressable
        unstable_pressDelay={SCROLL_PRESS_DELAY}
        style={[styles.item, selectable && styles.choice, stackedActions && styles.stackedChoice, disabled && styles.disabled]}
        onPress={handlePress}
        disabled={disabled}
        accessibilityRole={selectable ? 'radio' : 'button'}
        accessibilityState={{ disabled, ...(selectable ? { selected, checked: selected } : {}) }}
      >
        {icon ? (
          <Ionicons name={icon} size={20} color={destructive || selected ? tint : colors.textSecondary} />
        ) : null}
        <View style={styles.itemMeta}>
          <Text variant="body" color={tint}>
            {label}
          </Text>
          {subtitle ? (
            <Text variant="caption" color={colors.textSecondary}>
              {subtitle}
            </Text>
          ) : null}
        </View>
        {selected ? <Ionicons name="checkmark" size={18} color={colors.accentTextStrong} /> : null}
      </AppPressable>
      {trailing ? (
        <View style={[
          styles.trailing,
          stackedActions && styles.stackedActions,
          stackedActions && !!icon && styles.stackedActionsWithIcon,
        ]}>
          {trailing}
        </View>
      ) : null}
    </View>
  );
}

const useStyles = createThemedStyles((colors) => ({
  sheetBg: {
    backgroundColor: colors.bgSecondary,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
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
    color: colors.textSecondary,
    letterSpacing: 1,
    paddingHorizontal: spacing.sm,
    marginTop: spacing.md,
    marginBottom: spacing.xs,
  },
  firstSection: { marginTop: 0 },
  titleBlock: {
    marginBottom: spacing.md,
    paddingHorizontal: spacing.sm,
    gap: spacing.xs,
  },
  body: {
    paddingHorizontal: spacing.sm,
  },
  fieldLabel: {
    marginBottom: spacing.sm,
  },
  footer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'stretch',
    justifyContent: 'flex-end',
    gap: spacing.sm,
    paddingHorizontal: spacing.sm,
    marginTop: spacing.lg,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.glassBorder,
    marginHorizontal: spacing.sm,
    marginVertical: spacing.xs,
  },
  itemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 14,
  },
  selectedRow: {
    backgroundColor: mixHex(colors.bgTertiary, colors.accent, 0.18),
  },
  rowWithActions: {
    gap: spacing.sm,
    paddingRight: spacing.sm,
    // Keep the 44dp actions inset in the selected surface without adding row gaps.
    paddingVertical: spacing.xs,
  },
  stackedRow: {
    flexDirection: 'column',
    alignItems: 'stretch',
    gap: 0,
  },
  item: {
    flex: 1,
    minWidth: 0,
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
    borderRadius: 14,
  },
  choice: {
    paddingVertical: 6,
    gap: 10,
  },
  stackedChoice: {
    flex: 0,
    width: '100%',
  },
  trailing: {
    flexShrink: 0,
  },
  stackedActions: {
    alignSelf: 'flex-start',
    marginStart: spacing.sm,
  },
  stackedActionsWithIcon: {
    marginStart: 38,
  },
  itemMeta: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  disabled: { opacity: 0.45 },
}));

export default AppSheet;

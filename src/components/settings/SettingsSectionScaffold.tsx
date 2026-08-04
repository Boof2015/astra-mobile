import type { ReactNode } from 'react';
import {
  Pressable,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import Animated from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { Screen } from '@/components/Screen';
import { ScreenHeader, useScreenHeader } from '@/components/ScreenHeader';
import { Text } from '@/components/Text';
import { radius, spacing } from '@/theme';
import { createThemedStyles, useColors } from '@/theme/themed';
import { SCROLL_PRESS_DELAY, useRipple } from '@/theme/ripple';
import { HapticSwitch } from '@/components/HapticSwitch';

export type SettingsIconName = keyof typeof Ionicons.glyphMap;

export function SettingsSectionScreen({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  const styles = useStyles();
  const router = useRouter();
  const header = useScreenHeader({});

  return (
    // The header is an overlay the content scrolls under, so the screen keeps
    // neither the top inset nor the gutter — both move into the ScrollView.
    <Screen padded={false} style={styles.screen}>
      <Animated.ScrollView
        showsVerticalScrollIndicator={false}
        onScroll={header.onScroll}
        scrollEventThrottle={header.scrollEventThrottle}
        contentContainerStyle={[styles.content, { paddingTop: header.contentPaddingTop }]}
      >
        {children}
      </Animated.ScrollView>

      <ScreenHeader
        header={header}
        title={title}
        backLabel="Settings"
        onBack={() => router.back()}
      />
    </Screen>
  );
}

export function SettingsCard({
  children,
  style,
}: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  const styles = useStyles();
  return <View style={[styles.card, style]}>{children}</View>;
}

export function SettingsSectionLabel({
  children,
  spaced = false,
}: {
  children: ReactNode;
  spaced?: boolean;
}) {
  const styles = useStyles();
  const colors = useColors();
  return (
    <Text
      variant="label"
      color={colors.textTertiary}
      style={[styles.sectionLabel, spaced && styles.sectionSpacing]}
    >
      {children}
    </Text>
  );
}

export function SettingsNavRow({
  icon,
  title,
  subtitle,
  onPress,
  subtitleColor,
  rightIcon = 'chevron-forward',
}: {
  icon: SettingsIconName;
  title: string;
  subtitle: string;
  onPress: () => void;
  subtitleColor?: string;
  rightIcon?: SettingsIconName;
}) {
  const styles = useStyles();
  const colors = useColors();
  const ripple = useRipple();
  return (
    <Pressable android_ripple={ripple.bounded} unstable_pressDelay={SCROLL_PRESS_DELAY} style={styles.row} onPress={onPress} accessibilityRole="button">
      <View style={styles.rowIcon}>
        <Ionicons name={icon} size={20} color={colors.accent} />
      </View>
      <View style={styles.rowMeta}>
        <Text variant="body">{title}</Text>
        <Text
          variant="caption"
          color={subtitleColor ?? colors.textSecondary}
          numberOfLines={2}
          style={styles.rowSubtitle}
        >
          {subtitle}
        </Text>
      </View>
      <Ionicons name={rightIcon} size={18} color={colors.textTertiary} />
    </Pressable>
  );
}

export function SettingsToggleRow({
  title,
  description,
  value,
  onValueChange,
}: {
  title: string;
  description: string;
  value: boolean;
  onValueChange: (v: boolean) => void;
}) {
  const styles = useStyles();
  const colors = useColors();
  return (
    <View style={styles.toggleRow}>
      <View style={styles.toggleText}>
        <Text variant="body">{title}</Text>
        <Text variant="caption" color={colors.textSecondary} style={styles.rowSubtitle}>
          {description}
        </Text>
      </View>
      <HapticSwitch
        value={value}
        onValueChange={onValueChange}
        trackColor={{ false: colors.glassBorder, true: colors.accent }}
        thumbColor={colors.textPrimary}
      />
    </View>
  );
}

const useStyles = createThemedStyles((colors) => ({
  // The header draws behind the status bar; the ScrollView pays the inset.
  screen: {
    paddingTop: 0,
  },
  content: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.xxl,
    gap: spacing.sm,
  },
  sectionLabel: {
    letterSpacing: 1,
    marginBottom: spacing.sm,
  },
  sectionSpacing: {
    marginTop: spacing.xxl,
  },
  card: {
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glassBorder,
    backgroundColor: colors.glassBg,
    padding: spacing.lg,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.lg,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glassBorder,
    backgroundColor: colors.glassBg,
  },
  rowIcon: {
    width: 36,
    height: 36,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.bgTertiary,
  },
  rowMeta: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  rowSubtitle: {
    lineHeight: 16,
  },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  toggleText: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
}));

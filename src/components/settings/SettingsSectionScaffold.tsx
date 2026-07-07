import type { ReactNode } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { Screen } from '@/components/Screen';
import { Text } from '@/components/Text';
import { radius, spacing } from '@/theme';
import { createThemedStyles, useColors } from '@/theme/themed';

export type SettingsIconName = keyof typeof Ionicons.glyphMap;

export function SettingsSectionScreen({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  const styles = useStyles();
  const colors = useColors();
  const router = useRouter();

  return (
    <Screen>
      <View style={styles.header}>
        <Pressable style={styles.back} onPress={() => router.back()} hitSlop={8}>
          <Ionicons name="chevron-back" size={22} color={colors.textSecondary} />
          <Text variant="body" color={colors.textSecondary}>
            Settings
          </Text>
        </Pressable>
      </View>

      <Text variant="title" style={styles.heading}>
        {title}
      </Text>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
        {children}
      </ScrollView>
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
  return (
    <Pressable style={styles.row} onPress={onPress} accessibilityRole="button">
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
      <Switch
        value={value}
        onValueChange={onValueChange}
        trackColor={{ false: colors.glassBorder, true: colors.accent }}
        thumbColor={colors.textPrimary}
      />
    </View>
  );
}

const useStyles = createThemedStyles((colors) => ({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: spacing.md,
  },
  back: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  heading: {
    marginTop: spacing.lg,
    marginBottom: spacing.lg,
  },
  content: {
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

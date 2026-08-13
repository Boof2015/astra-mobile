import type { ComponentProps } from 'react';
import { StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '@/components/Text';
import { spacing } from '@/theme';
import { createThemedStyles, useColors } from '@/theme/themed';

type IoniconName = ComponentProps<typeof Ionicons>['name'];

/**
 * Shared masthead for every wizard page: medallion icon, title, and the one-line
 * reason the page exists. Lives outside OnboardingFlow so the individual step
 * files can use it without importing their own parent.
 */
export function StepHeader({
  icon,
  title,
  subtitle,
}: {
  icon: IoniconName;
  title: string;
  subtitle: string;
}) {
  const styles = useStyles();
  const colors = useColors();
  return (
    <View style={styles.stepHeader}>
      <View style={styles.stepIconWrap}>
        <Ionicons name={icon} size={26} color={colors.accent} />
      </View>
      <Text variant="heading" style={styles.title}>
        {title}
      </Text>
      <Text variant="body" color={colors.textSecondary} style={styles.subtitle}>
        {subtitle}
      </Text>
    </View>
  );
}

const useStyles = createThemedStyles((colors) => ({
  stepHeader: {
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.xs,
  },
  stepIconWrap: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.glassBg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glassBorder,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.xs,
  },
  title: {
    textAlign: 'center',
  },
  subtitle: {
    textAlign: 'center',
    maxWidth: 340,
  },
}));

export default StepHeader;

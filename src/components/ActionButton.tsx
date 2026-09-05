import { AppPressable, type AppPressableProps } from '@/components/AppPressable';
import { Text } from '@/components/Text';
import { actionButtonStyle, actionButtonTextStyle, type ActionButtonVariant } from '@/theme/actionButtons';
import { createThemedStyles, useColors } from '@/theme/themed';
import { Ionicons } from '@expo/vector-icons';
import { forwardRef, type ReactNode } from 'react';
import { ActivityIndicator, StyleSheet, type View } from 'react-native';

export interface ActionButtonProps extends Omit<AppPressableProps, 'children' | 'feedback' | 'feedbackRadius'> {
  label: ReactNode;
  variant?: ActionButtonVariant;
  icon?: keyof typeof Ionicons.glyphMap;
  iconSize?: number;
  iconPosition?: 'start' | 'end';
  loading?: boolean;
}

/** Labeled actions share their appearance and states; callers own placement and width. */
export const ActionButton = forwardRef<View, ActionButtonProps>(function ActionButton(
  {
    label,
    variant = 'secondary',
    icon,
    iconSize = 18,
    iconPosition = 'start',
    loading = false,
    disabled = false,
    style,
    accessibilityState,
    ...props
  },
  ref,
) {
  const styles = useStyles();
  const colors = useColors();
  const unavailable = disabled || loading;
  const labelStyle = actionButtonTextStyle(colors, variant);

  return (
    <AppPressable
      {...props}
      ref={ref}
      feedback={variant === 'primary' ? 'accent' : 'control'}
      disabled={unavailable}
      accessibilityRole="button"
      accessibilityState={{ ...accessibilityState, disabled: unavailable, busy: loading || accessibilityState?.busy === true }}
      style={(state) => [
        styles[variant],
        iconPosition === 'end' && styles.iconEnd,
        typeof style === 'function' ? style(state) : style,
        unavailable && styles.disabled,
      ]}
    >
      {loading ? (
        <ActivityIndicator size="small" color={labelStyle.color} style={StyleSheet.absoluteFill} />
      ) : null}
      {icon ? (
        <Ionicons name={icon} size={iconSize} color={labelStyle.color} style={loading && styles.hiddenContent} />
      ) : null}
      {/* Keep content measured while loading so the button retains its size. */}
      <Text variant="body" style={[labelStyle, loading && styles.hiddenContent]}>
        {label}
      </Text>
    </AppPressable>
  );
});

const useStyles = createThemedStyles((colors) => ({
  primary: actionButtonStyle(colors, 'primary'),
  secondary: actionButtonStyle(colors, 'secondary'),
  danger: actionButtonStyle(colors, 'danger'),
  iconEnd: { flexDirection: 'row-reverse' },
  hiddenContent: { opacity: 0 },
  disabled: { opacity: 0.45 },
}));

import { actionButtonForeground, actionButtonStyle, actionButtonTextStyle } from '@/theme/actionButtons';
import {
  ActivityIndicator,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '@/components/Text';
import { radius, spacing } from '@/theme';
import { createThemedStyles, useColors } from '@/theme/themed';
import { AppPressable } from '@/components/AppPressable';
import { useScanNotificationPermission } from '@/library/useScanNotificationPermission';

/**
 * Dense settings-list form of the notification permission, rendered only while
 * there is still something to ask for. A permanently-satisfied "Allowed" row is
 * noise in a settings list, so the card removes itself once the permission is
 * held (or was never required) — including the surrounding spacing, which is why
 * the caller passes `style` instead of wrapping this in its own View.
 *
 * The onboarding wizard deliberately does not reuse this: it has a whole page to
 * fill, so it renders its own layout over the same
 * `useScanNotificationPermission` state.
 */
export function ScanNotificationPermissionCard({
  style,
}: {
  style?: StyleProp<ViewStyle>;
}) {
  const styles = useStyles();
  const colors = useColors();
  const { state, granted, denied, working, resolve } = useScanNotificationPermission();

  // Also hidden while the first check is in flight, so the row never appears
  // just to vanish a frame later on an already-granted device.
  if (state === null || granted) return null;

  return (
    <View style={[styles.card, style]}>
      <View style={styles.header}>
        <View style={styles.icon}>
          <Ionicons name="notifications-outline" size={20} color={colors.accent} />
        </View>
        <View style={styles.copy}>
          <Text variant="body">Scan progress notification</Text>
          <Text variant="caption" color={colors.textSecondary}>
            The temporary notification shows progress and lets Android keep a scan running
            after you leave Astra. Scans still work if you skip it.
          </Text>
        </View>
      </View>

      <AppPressable feedback="accent"

        style={styles.button}
        disabled={working}
        onPress={resolve}
        accessibilityRole="button"
      >
        {working ? (
          <ActivityIndicator size="small" color={actionButtonForeground(colors)} />
        ) : (
          <Ionicons
            name={denied ? 'settings-outline' : 'notifications-outline'}
            size={18}
            color={actionButtonForeground(colors)}
          />
        )}
        <Text style={actionButtonTextStyle(colors, 'primary')} variant="label">
          {denied ? 'Open Settings' : 'Allow scan notifications'}
        </Text>
      </AppPressable>

      {denied ? (
        <Text variant="caption" color={colors.textTertiary}>
          Notification permission is denied. You can enable it in Android settings.
        </Text>
      ) : null}
    </View>
  );
}

const useStyles = createThemedStyles((colors) => ({
  card: {
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glassBorder,
    backgroundColor: colors.bgSecondary,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
  },
  icon: {
    width: 36,
    height: 36,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.accentGlow,
  },
  copy: {
    flex: 1,
    gap: 4,
  },
  button: {
    ...actionButtonStyle(colors, 'primary'),
    overflow: 'hidden',
  },
}));

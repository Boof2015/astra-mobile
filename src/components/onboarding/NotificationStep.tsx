import { actionButtonForeground, actionButtonStyle, actionButtonTextStyle } from '@/theme/actionButtons';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '@/components/Text';
import { StepHeader } from '@/components/onboarding/StepHeader';
import { radius, spacing } from '@/theme';
import { createThemedStyles, useColors } from '@/theme/themed';
import { AppPressable } from '@/components/AppPressable';
import { useLibraryStore } from '@/stores/libraryStore';
import type { ScanNotificationPermission } from '@/library/useScanNotificationPermission';

/**
 * Wizard page for the POST_NOTIFICATIONS grant. Deliberately not the settings
 * `ScanNotificationPermissionCard`: with a whole page to work with, the ask gets
 * a sketch of the actual notification and one unmistakable action instead of a
 * dense list row. The permission state is owned by OnboardingFlow so the footer
 * button can say "Continue" vs "Skip for now" from the same source of truth.
 */
export function NotificationStep({
  permission,
}: {
  permission: ScanNotificationPermission;
}) {
  const styles = useStyles();
  const colors = useColors();
  const isScanning = useLibraryStore((s) => s.isScanning);
  const { state, granted, denied, working, resolve } = permission;

  return (
    <View style={styles.stepBody}>
      <StepHeader
        icon="notifications-outline"
        title="Keep scans running"
        subtitle={
          isScanning
            ? 'Your scan is running now. Android needs permission to show its progress and keep it going after you leave Astra.'
            : 'Astra shows a temporary progress notification while scanning. It is what lets Android keep a scan running after you leave the app.'
        }
      />

      <NotificationSketch />

      {state === null ? (
        <ActivityIndicator size="small" color={colors.accent} />
      ) : granted ? (
        <View style={styles.grantedRow}>
          <Ionicons name="checkmark-circle" size={20} color={colors.accent} />
          <Text variant="body" color={colors.textPrimary}>
            {state === 'not_required'
              ? 'No permission needed on this Android version'
              : 'Notifications allowed'}
          </Text>
        </View>
      ) : (
        <AppPressable feedback="accent"

          style={styles.button}
          disabled={working}
          onPress={resolve}
          accessibilityRole="button"
          accessibilityLabel={denied ? 'Open Android settings' : 'Allow scan notifications'}
        >
          {working ? (
            <ActivityIndicator size="small" color={actionButtonForeground(colors)} />
          ) : (
            <Ionicons
              name={denied ? 'settings-outline' : 'notifications-outline'}
              size={19}
              color={actionButtonForeground(colors)}
            />
          )}
          <Text style={actionButtonTextStyle(colors, 'primary')} variant="label">
            {denied ? 'Open Android settings' : 'Allow notifications'}
          </Text>
        </AppPressable>
      )}

      <Text variant="caption" color={colors.textTertiary} style={styles.footnote}>
        {denied
          ? 'Notifications are currently blocked for Astra. Scans still work — they just stop early if Android needs the memory.'
          : 'Optional. Scans still work without it, but Android may stop a long scan once you leave the app.'}
      </Text>
    </View>
  );
}

/**
 * Miniature of the real scan notification. Static numbers on purpose — a live
 * counter here would compete with the actual ScanBanner above the page.
 */
function NotificationSketch() {
  const styles = useStyles();
  const colors = useColors();
  return (
    <View style={styles.sketch}>
      <View style={styles.sketchHeader}>
        <View style={styles.sketchAppIcon}>
          <Ionicons name="musical-note" size={11} color={colors.bgPrimary} />
        </View>
        <Text variant="caption" color={colors.textSecondary}>
          Astra
        </Text>
        <View style={styles.sketchSeparator} />
        <Text variant="caption" color={colors.textTertiary}>
          now
        </Text>
      </View>
      <Text variant="body" numberOfLines={1}>
        Scanning your library
      </Text>
      <Text variant="caption" color={colors.textSecondary} numberOfLines={1}>
        1,204 of 3,180 tracks
      </Text>
      <View style={styles.sketchTrack}>
        <View style={styles.sketchFill} />
      </View>
    </View>
  );
}

const useStyles = createThemedStyles((colors) => ({
  stepBody: {
    width: '100%',
    gap: spacing.lg,
  },
  sketch: {
    gap: spacing.xs,
    padding: spacing.md,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glassBorder,
    backgroundColor: colors.bgSecondary,
  },
  sketchHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    marginBottom: 2,
  },
  sketchAppIcon: {
    width: 18,
    height: 18,
    borderRadius: 5,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.accent,
  },
  sketchSeparator: {
    width: 3,
    height: 3,
    borderRadius: 1.5,
    backgroundColor: colors.textTertiary,
  },
  sketchTrack: {
    height: 4,
    borderRadius: 2,
    overflow: 'hidden',
    backgroundColor: colors.bgTertiary,
    marginTop: spacing.xs,
  },
  sketchFill: {
    width: '38%',
    height: '100%',
    borderRadius: 2,
    backgroundColor: colors.accent,
  },
  button: {
    ...actionButtonStyle(colors, 'primary'),
    minHeight: 52,
    overflow: 'hidden',
  },
  grantedRow: {
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glassBorder,
    backgroundColor: colors.glassBg,
  },
  footnote: {
    textAlign: 'center',
  },
}));

export default NotificationStep;

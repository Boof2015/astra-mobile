import { ActionButton } from '@/components/ActionButton';
import { StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '@/components/Text';
import { spacing } from '@/theme';
import { createThemedStyles, useColors } from '@/theme/themed';
import { useLibraryStore } from '@/stores/libraryStore';
import { OnboardingFrame, useOnboardingNav } from './OnboardingFrame';

/**
 * The POST_NOTIFICATIONS ask. Only shown when a folder scan has started and the
 * grant is missing (see onboardingSteps). The ask is the footer's main action,
 * so the page never has two primary buttons.
 */
export function NotificationStep() {
  const styles = useStyles();
  const colors = useColors();
  const nav = useOnboardingNav();
  const isScanning = useLibraryStore((s) => s.isScanning);
  const { state, granted, denied, working, resolve } = nav.notificationPermission;

  const footer = granted ? (
    <ActionButton style={styles.grow} variant="primary" label="Continue" onPress={nav.next} />
  ) : (
    <>
      <ActionButton style={styles.button} variant="secondary" label="Not now" onPress={nav.next} />
      <ActionButton
        style={styles.grow}
        variant="primary"
        label={denied ? 'Open Android settings' : 'Allow notifications'}
        accessibilityLabel={denied ? 'Open Android settings' : 'Allow scan notifications'}
        disabled={state === null || working}
        loading={working}
        onPress={resolve}
      />
    </>
  );

  return (
    <OnboardingFrame
      eyebrow="Scanning"
      title="Keep scans running"
      subtitle={
        isScanning
          ? 'Your scan is running now. Android needs permission to show its progress and keep it going when you leave Astra.'
          : 'Astra shows a progress notification while it scans. That is what lets Android keep a scan going after you leave the app.'
      }
      footer={footer}
    >
      <NotificationSketch />
      {granted ? (
        <View style={styles.grantedRow}>
          <Ionicons name="checkmark-circle" size={20} color={colors.accent} />
          <Text variant="body">
            {state === 'not_required' ? 'No permission needed on this Android version' : 'Notifications allowed'}
          </Text>
        </View>
      ) : (
        <Text variant="caption" color={colors.textTertiary} style={styles.footnote}>
          {denied
            ? 'Notifications are blocked for Astra. Scans still work, but Android may stop a long one once you leave the app.'
            : 'Optional. Without it, Android may stop a long scan once you leave the app.'}
        </Text>
      )}
    </OnboardingFrame>
  );
}

/** Miniature of the real scan notification, following the scan that's running. */
function NotificationSketch() {
  const styles = useStyles();
  const colors = useColors();
  const progress = useLibraryStore((s) => s.scanProgress);
  const isScanning = useLibraryStore((s) => s.isScanning);
  const counted = isScanning && progress.total > 0 && (progress.phase === 'extracting' || progress.phase === 'analyzing');
  const fraction = counted ? Math.min(1, progress.processed / progress.total) : 0.38;
  return (
    <View style={styles.sketch} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
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
      <Text variant="mono" color={colors.textSecondary} numberOfLines={1}>
        {counted
          ? `${progress.processed.toLocaleString('en-US')} of ${progress.total.toLocaleString('en-US')} tracks`
          : '1,204 of 3,180 tracks'}
      </Text>
      <View style={styles.sketchTrack}>
        <View style={[styles.sketchFill, { width: `${fraction * 100}%` }]} />
      </View>
    </View>
  );
}

const useStyles = createThemedStyles((colors) => ({
  grow: {
    flex: 1,
    minHeight: 52,
  },
  button: {
    minHeight: 52,
  },
  sketch: {
    gap: spacing.xs,
    padding: spacing.lg,
    borderRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glassBorder,
    backgroundColor: colors.bgTertiary,
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
    borderRadius: 9,
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
    backgroundColor: colors.glassBorder,
    marginTop: spacing.xs,
  },
  sketchFill: {
    height: '100%',
    borderRadius: 2,
    backgroundColor: colors.accent,
  },
  grantedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.lg,
  },
  footnote: {
    marginTop: spacing.lg,
  },
}));

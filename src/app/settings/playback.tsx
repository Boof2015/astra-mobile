import { SleepTimerControls } from '@/components/player/SleepTimerControls';
import { StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { AstraLibraryData } from '../../../modules/astra-library-scanner';
import {
  SettingsCard,
  SettingsSectionLabel,
  SettingsSectionScreen,
  SettingsToggleRow,
} from '@/components/settings/SettingsSectionScaffold';
import { Text } from '@/components/Text';
import { showAppDialog } from '@/components/dialogs/AppDialog';
import {
  pauseListeningHistoryTracking,
  resumeListeningHistoryTracking,
} from '@/audio/listeningHistoryTracker';
import { useSettingsStore } from '@/stores/settingsStore';
import { radius, spacing } from '@/theme';
import { createThemedStyles, useColors } from '@/theme/themed';
import { AppPressable } from '@/components/AppPressable';
import { notifyListeningHistoryChanged } from '@/listeningStats/events';

export default function PlaybackSettingsScreen() {
  const styles = useStyles();
  const colors = useColors();
  const historyEnabled = useSettingsStore((s) => s.listeningHistoryEnabled);
  const setHistoryEnabled = useSettingsStore((s) => s.setListeningHistoryEnabled);

  const confirmClear = () => {
    showAppDialog({
      title: 'Clear detailed listening history?',
      message:
        'Listening time, activity, and rankings recorded on this phone will be removed. Play counts, recents, favorites, playlists, and last-played dates are preserved.',
      actions: [
        { label: 'Cancel', role: 'cancel' },
        {
          label: 'Clear history',
          role: 'destructive',
          onPress: () => {
            void (async () => {
              await pauseListeningHistoryTracking();
              try {
                await AstraLibraryData.clearDetailedListeningHistory();
                notifyListeningHistoryChanged();
              } finally {
                if (useSettingsStore.getState().listeningHistoryEnabled) {
                  resumeListeningHistoryTracking();
                }
              }
            })().catch((error) => {
              showAppDialog({
                title: 'Could not clear history',
                message: error instanceof Error ? error.message : 'Please try again.',
              });
            });
          },
        },
      ],
    });
  };

  return (
    <SettingsSectionScreen title="Playback">
      <SettingsSectionLabel>SLEEP TIMER</SettingsSectionLabel>
      <SettingsCard>
        <SleepTimerControls />
      </SettingsCard>

      <SettingsSectionLabel spaced>LISTENING HISTORY</SettingsSectionLabel>
      <SettingsCard>
        <SettingsToggleRow
          title="Listening History"
          description="Record detailed listening time and qualified plays on this phone."
          value={historyEnabled}
          onValueChange={(enabled) => {
            void setHistoryEnabled(enabled).catch((error) => {
              showAppDialog({
                title: 'Could not update Listening History',
                message: error instanceof Error ? error.message : 'Please try again.',
              });
            });
          }}
        />
        <View style={styles.divider} />
        <AppPressable feedback="control"

          style={styles.clearRow}
          onPress={confirmClear}
          accessibilityRole="button"
        >
          <Ionicons name="trash-outline" size={20} color={colors.warning} />
          <View style={styles.clearMeta}>
            <Text variant="body" color={colors.warning}>
              Clear Detailed Listening History
            </Text>
            <Text variant="caption" color={colors.textSecondary}>
              Keeps play counts, recents, favorites, and playlists.
            </Text>
          </View>
        </AppPressable>
      </SettingsCard>
    </SettingsSectionScreen>
  );
}

const useStyles = createThemedStyles((colors) => ({
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.glassBorder,
    marginVertical: spacing.lg,
  },
  clearRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radius.sm,
    overflow: 'hidden',
  },
  clearMeta: {
    flex: 1,
    gap: 2,
  },
}));

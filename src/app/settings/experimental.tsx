import { useEffect } from 'react';
import { Alert, InteractionManager } from 'react-native';
import { useRouter } from 'expo-router';
import {
  SettingsNavRow,
  SettingsSectionLabel,
  SettingsSectionScreen,
} from '@/components/settings/SettingsSectionScaffold';
import { formatRelativeTime } from '@/lib/format';
import { useColors } from '@/theme/themed';
import { useDesktopRemoteStore } from '@/stores/desktopRemoteStore';
import { useDesktopSyncStore } from '@/stores/desktopSyncStore';
import { useOnboardingStore } from '@/stores/onboardingStore';

export default function ExperimentalSettingsScreen() {
  const colors = useColors();
  const router = useRouter();
  const desktopRemoteConnection = useDesktopRemoteStore((s) => s.connection);
  const desktopRemoteState = useDesktopRemoteStore((s) => s.connectionState);
  const initDesktopRemote = useDesktopRemoteStore((s) => s.init);
  const desktopSyncStatus = useDesktopSyncStore((s) => s.status);
  const desktopLastSyncAt = useDesktopSyncStore((s) => s.lastSyncAt);
  const desktopSyncConflictCount = useDesktopSyncStore((s) => s.conflicts.length);

  useEffect(() => {
    const task = InteractionManager.runAfterInteractions(() => {
      void initDesktopRemote();
    });
    return () => task.cancel();
  }, [initDesktopRemote]);

  const desktopRemoteSubtitle = desktopRemoteConnection
    ? `${desktopRemoteConnection.desktopName ?? 'Astra Desktop'}: ${desktopRemoteState === 'connected' ? 'connected' : desktopRemoteState}`
    : 'Pair with Astra Desktop to control playback from this phone.';
  const replayOnboarding = () => {
    Alert.alert(
      'Replay onboarding?',
      'The first-run setup wizard will show again the next time you return to the home screen. Your library and settings are kept.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Replay', onPress: () => void useOnboardingStore.getState().reset() },
      ]
    );
  };

  const desktopSyncSubtitle = !desktopRemoteConnection
    ? 'Sync favorites and playlists with Astra Desktop.'
    : desktopSyncConflictCount > 0
      ? `${desktopSyncConflictCount} conflict${desktopSyncConflictCount === 1 ? '' : 's'} to resolve.`
      : desktopSyncStatus === 'syncing'
        ? 'Syncing.'
        : desktopLastSyncAt !== null
          ? `Synced ${formatRelativeTime(desktopLastSyncAt)}.`
          : `${desktopRemoteConnection.desktopName ?? 'Astra Desktop'}: not synced yet.`;

  return (
    <SettingsSectionScreen title="Experimental">
      <SettingsSectionLabel>DESKTOP</SettingsSectionLabel>
      <SettingsNavRow
        icon="phone-portrait-outline"
        title="Desktop Remote"
        subtitle={desktopRemoteSubtitle}
        onPress={() => router.push('/desktop-remote' as never)}
      />
      <SettingsNavRow
        icon="sync-outline"
        title="Desktop Sync"
        subtitle={desktopSyncSubtitle}
        subtitleColor={desktopSyncConflictCount > 0 ? colors.warning : undefined}
        onPress={() => router.push('/desktop-sync' as never)}
      />

      <SettingsSectionLabel>DEVELOPER</SettingsSectionLabel>
      <SettingsNavRow
        icon="pulse-outline"
        title="Haptics Lab"
        subtitle="Audition semantic feedback, device primitives, and signature candidates."
        onPress={() => router.push('/settings/haptics-lab' as never)}
      />
      <SettingsNavRow
        icon="refresh-outline"
        title="Replay onboarding"
        subtitle="Show the first-run setup wizard again."
        onPress={replayOnboarding}
      />
    </SettingsSectionScreen>
  );
}

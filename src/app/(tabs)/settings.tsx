import { useEffect } from 'react';
import {
  InteractionManager,
  ScrollView,
} from 'react-native';
import Constants from 'expo-constants';
import { useRouter } from 'expo-router';
import { Screen } from '@/components/Screen';
import { Text } from '@/components/Text';
import {
  formatFolderCount,
  formatTrackCount,
  themeOptionTitle,
} from '@/components/settings/SettingsPanels';
import {
  SettingsNavRow,
  SettingsSectionLabel,
} from '@/components/settings/SettingsSectionScaffold';
import { spacing } from '@/theme';
import { createThemedStyles, useColors } from '@/theme/themed';
import { formatRelativeTime } from '@/lib/format';
import { useAudioSettingsStore } from '@/stores/audioSettingsStore';
import { useDesktopRemoteStore } from '@/stores/desktopRemoteStore';
import { useDesktopSyncStore } from '@/stores/desktopSyncStore';
import { useLastFmSettingsStore } from '@/stores/lastFmSettingsStore';
import { useLibraryStore } from '@/stores/libraryStore';
import { useRemoteSourcesStore } from '@/stores/remoteSourcesStore';
import { useThemeStore } from '@/stores/themeStore';

function formatEnabled(value: boolean): string {
  return value ? 'On' : 'Off';
}

export default function SettingsScreen() {
  const styles = useStyles();
  const colors = useColors();
  const router = useRouter();

  const baseTheme = useThemeStore((s) => s.baseTheme);
  const folders = useLibraryStore((s) => s.folders);
  const normalizationEnabled = useAudioSettingsStore((s) => s.normalizationEnabled);
  const replayGainEnabled = useAudioSettingsStore((s) => s.replayGainEnabled);
  const remoteSources = useRemoteSourcesStore((s) => s.sources);
  const lastFmStatus = useLastFmSettingsStore((s) => s.status);
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

  const totalTracks = folders.reduce((sum, folder) => sum + folder.track_count, 0);
  const connectedScrobblers = lastFmStatus?.profiles.filter((p) => p.connected).length ?? 0;
  const appVersion = Constants.expoConfig?.version;

  const librarySubtitle = folders.length === 0
    ? 'Folders, artist grouping, album singles.'
    : `${formatFolderCount(folders.length)} / ${formatTrackCount(totalTracks)}. Artist grouping and albums.`;
  const servicesSubtitle = remoteSources.length === 0 && connectedScrobblers === 0
    ? 'Remote sources and scrobbling.'
    : `${remoteSources.length} server${remoteSources.length === 1 ? '' : 's'}, ${connectedScrobblers} scrobble destination${connectedScrobblers === 1 ? '' : 's'}.`;
  const desktopRemoteSubtitle = desktopRemoteConnection
    ? `${desktopRemoteConnection.desktopName ?? 'Astra Desktop'}: ${desktopRemoteState === 'connected' ? 'connected' : desktopRemoteState}`
    : 'Desktop Remote and Desktop Sync.';
  const desktopSyncSubtitle = desktopSyncConflictCount > 0
    ? `${desktopSyncConflictCount} sync conflict${desktopSyncConflictCount === 1 ? '' : 's'} to resolve.`
    : desktopSyncStatus === 'syncing'
      ? 'Desktop Sync is running.'
      : desktopLastSyncAt !== null
        ? `Desktop Sync ${formatRelativeTime(desktopLastSyncAt)}.`
        : desktopRemoteSubtitle;

  return (
    <Screen>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
        <Text variant="title" style={styles.heading}>
          Settings
        </Text>

        <SettingsSectionLabel>SETTINGS</SettingsSectionLabel>
        <SettingsNavRow
          icon="color-palette-outline"
          title="Appearance"
          subtitle={`${themeOptionTitle(baseTheme)} theme, dark style, accent color.`}
          onPress={() => router.push('/settings/appearance' as never)}
        />
        <SettingsNavRow
          icon="library-outline"
          title="Library"
          subtitle={librarySubtitle}
          onPress={() => router.push('/settings/library' as never)}
        />
        <SettingsNavRow
          icon="volume-high"
          title="Audio"
          subtitle={`Normalization ${formatEnabled(normalizationEnabled)}. ReplayGain ${formatEnabled(replayGainEnabled)}.`}
          onPress={() => router.push('/settings/audio' as never)}
        />
        <SettingsNavRow
          icon="server-outline"
          title="Services"
          subtitle={servicesSubtitle}
          onPress={() => router.push('/settings/services' as never)}
        />
        <SettingsNavRow
          icon="flask-outline"
          title="Experimental"
          subtitle={desktopSyncSubtitle}
          subtitleColor={desktopSyncConflictCount > 0 ? colors.warning : undefined}
          onPress={() => router.push('/settings/experimental' as never)}
        />

        <SettingsSectionLabel spaced>ABOUT</SettingsSectionLabel>
        <SettingsNavRow
          icon="information-circle-outline"
          title="Info"
          subtitle={appVersion ? `v${appVersion}. Attribution, license, community links.` : 'Attribution, license, community links.'}
          onPress={() => router.push('/settings/info' as never)}
        />
      </ScrollView>
    </Screen>
  );
}

const useStyles = createThemedStyles(() => ({
  content: {
    paddingBottom: spacing.xxl,
    gap: spacing.sm,
  },
  heading: {
    marginTop: spacing.xl,
    marginBottom: spacing.xxl,
  },
}));

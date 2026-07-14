import { useRouter } from 'expo-router';
import { lastFmScrobbleSubtitle } from '@/components/settings/SettingsPanels';
import {
  SettingsNavRow,
  SettingsSectionLabel,
  SettingsSectionScreen,
} from '@/components/settings/SettingsSectionScaffold';
import { useLastFmSettingsStore } from '@/stores/lastFmSettingsStore';
import { useLyricsSettingsStore } from '@/stores/lyricsSettingsStore';
import { useRemoteSourcesStore } from '@/stores/remoteSourcesStore';

export default function ServicesSettingsScreen() {
  const router = useRouter();
  const remoteSources = useRemoteSourcesStore((s) => s.sources);
  const lastFmStatus = useLastFmSettingsStore((s) => s.status);
  const onlineLookupEnabled = useLyricsSettingsStore((s) => s.onlineLookupEnabled);

  return (
    <SettingsSectionScreen title="Services">
      <SettingsSectionLabel>REMOTE SOURCES</SettingsSectionLabel>
      <SettingsNavRow
        icon="server-outline"
        title="Subsonic / Jellyfin servers"
        subtitle={
          remoteSources.length === 0
            ? 'Stream and browse your self-hosted library.'
            : `${remoteSources.length} server${remoteSources.length === 1 ? '' : 's'} connected.`
        }
        onPress={() => router.push('/sources')}
      />

      <SettingsSectionLabel spaced>LYRICS</SettingsSectionLabel>
      <SettingsNavRow
        icon="musical-notes-outline"
        title="Lyrics"
        subtitle={`Online lookup ${onlineLookupEnabled ? 'on' : 'off'}. XLRC display and language priority.`}
        onPress={() => router.push('/settings/lyrics' as never)}
      />

      <SettingsSectionLabel spaced>SCROBBLING</SettingsSectionLabel>
      <SettingsNavRow
        icon="radio-outline"
        title="Last.fm & scrobbling"
        subtitle={lastFmScrobbleSubtitle(lastFmStatus)}
        onPress={() => router.push('/lastfm')}
      />
    </SettingsSectionScreen>
  );
}

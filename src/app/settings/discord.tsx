import { useState } from 'react';
import { Linking, StyleSheet, View } from 'react-native';
import { Text } from '@/components/Text';
import { AppPressable } from '@/components/AppPressable';
import { SegmentedControl, type Segment } from '@/components/SegmentedControl';
import {
  SettingsCard,
  SettingsSectionLabel,
  SettingsSectionScreen,
  SettingsNavRow,
  SettingsToggleRow,
} from '@/components/settings/SettingsSectionScaffold';
import { spacing } from '@/theme';
import { createThemedStyles, useColors } from '@/theme/themed';
import { useDiscordStatus, type DiscordPreferences } from '../../../modules/astra-discord';

const compactModes: Segment[] = [{ key: 'title', label: 'Title' }, { key: 'artist', label: 'Artist' }];
const infoModes: Segment[] = [{ key: 'file-info', label: 'File Info' }, { key: 'album', label: 'Album' }];
const linkModes: Segment[] = [{ key: 'ytmusic', label: 'YT Music' }, { key: 'lastfm', label: 'Last.fm' }, { key: 'off', label: 'Off' }];
const pauseModes: Segment[] = [0, 1, 5, 15, 30].map((minutes) => ({ key: String(minutes), label: minutes ? `${minutes}m` : 'Off' }));

function Choice({ title, description, segments, value, onChange }: {
  title: string; description: string; segments: Segment[]; value: string; onChange: (value: string) => void;
}) {
  const colors = useColors();
  const styles = useStyles();
  return (
    <View style={styles.choice}>
      <Text variant="body">{title}</Text>
      <Text variant="caption" color={colors.textSecondary}>{description}</Text>
      <SegmentedControl segments={segments} value={value} onChange={onChange} />
    </View>
  );
}

export default function DiscordSettingsScreen() {
  const colors = useColors();
  const styles = useStyles();
  const { status, setEnabled, configure, clearArtworkCache } = useDiscordStatus();
  const settings = status.settings;
  const [cacheMessage, setCacheMessage] = useState('');
  const artworkMessage = status.artworkState === 'loading' ? 'Searching for public cover art…'
    : status.artworkState === 'found' ? `Cover art from ${status.artworkProvider ?? 'public search'}.`
      : status.artworkState === 'not-found' ? 'No matching public cover found. Using the Astra icon.'
        : status.artworkState === 'unavailable' ? 'Cover search is unavailable. Astra will retry automatically.' : '';
  const update = (options: Partial<DiscordPreferences>) => { void configure(options); };

  return (
    <SettingsSectionScreen title="Discord" backLabel="Services">
      <SettingsSectionLabel>RICH PRESENCE</SettingsSectionLabel>
      {status.available ? (
        <SettingsCard>
          <SettingsToggleRow
            title="Discord Rich Presence"
            description="Share your current track as Astra Mobile on your Discord profile."
            value={status.enabled}
            onValueChange={(enabled) => void setEnabled(enabled)}
          />
        </SettingsCard>
      ) : null}
      <SettingsCard>
        <Text variant="body" accessibilityLiveRegion="polite">{status.message}</Text>
      </SettingsCard>
      {status.available ? <>
        <Text variant="caption" color={colors.textSecondary}>
          Discord must be installed and signed in, with activity sharing enabled.
          {' '}Only enable this if you are at least 13 and meet Discord’s minimum age in your country.
        </Text>
        <SettingsNavRow
          icon="shield-checkmark-outline"
          title="Discord Terms & Privacy"
          subtitle="Your activity is shared under Discord’s terms and privacy policy."
          rightIcon="open-outline"
          onPress={() => { void Linking.openURL('https://discord.com/terms').catch(() => {}); }}
        />

        <SettingsSectionLabel spaced>APPEARANCE</SettingsSectionLabel>
        <SettingsCard style={styles.group}>
          <Choice title="Compact Status" description="Choose the text shown in Discord’s compact activity view."
            segments={compactModes} value={settings.compactStatusMode}
            onChange={(value) => update({ compactStatusMode: value as DiscordPreferences['compactStatusMode'] })} />
          <View style={styles.divider} />
          <Choice title="Profile Info Line" description="Show audio quality or the album in the expanded activity."
            segments={infoModes} value={settings.expandedInfoMode}
            onChange={(value) => update({ expandedInfoMode: value as DiscordPreferences['expandedInfoMode'] })} />
          <View style={styles.divider} />
          <Choice title="Title & Artist Links" description="Link the title, artist, and album artwork to a music service."
            segments={linkModes} value={settings.linkDestination}
            onChange={(value) => update({ linkDestination: value as DiscordPreferences['linkDestination'] })} />
        </SettingsCard>

        <SettingsSectionLabel spaced>COVER ART</SettingsSectionLabel>
        <SettingsCard style={styles.group}>
          <SettingsToggleRow title="Internet Cover Art"
            description="Search iTunes, MusicBrainz / Cover Art Archive, and TheAudioDB using track metadata. Embedded artwork is never uploaded."
            value={settings.coverArtEnabled} onValueChange={(coverArtEnabled) => update({ coverArtEnabled })} />
          {settings.coverArtEnabled ? <>
            <View style={styles.divider} />
            <SettingsToggleRow title="Astra Icon on Cover Art" description="Add a small Astra badge to the public album cover."
              value={settings.smallIconEnabled} onValueChange={(smallIconEnabled) => update({ smallIconEnabled })} />
            {artworkMessage ? <Text variant="caption" color={colors.textSecondary} accessibilityLiveRegion="polite">{artworkMessage}</Text> : null}
          </> : null}
          <View style={styles.divider} />
          <AppPressable accessibilityRole="button" accessibilityLabel="Clear cover art cache" onPress={() => {
            void clearArtworkCache().then(() => setCacheMessage('Cover art cache cleared.')).catch(() => setCacheMessage('Could not clear the cache. Please try again.'));
          }}>
            <Text variant="body" color={colors.accent}>Clear Cover Art Cache</Text>
            <Text variant="caption" color={colors.textSecondary}>Retry saved matches and covers that weren’t found.</Text>
          </AppPressable>
          {cacheMessage ? <Text variant="caption" accessibilityLiveRegion="polite" color={colors.textSecondary}>{cacheMessage}</Text> : null}
        </SettingsCard>

        <SettingsSectionLabel spaced>WHEN PAUSED</SettingsSectionLabel>
        <SettingsCard>
          <Choice title="Clear When Paused" description="Remove the activity after a continuous pause. Off keeps the paused track visible."
            segments={pauseModes} value={String(settings.pauseClearMinutes)}
            onChange={(value) => update({ pauseClearMinutes: Number(value) })} />
        </SettingsCard>
      </> : null}
    </SettingsSectionScreen>
  );
}

const useStyles = createThemedStyles((colors) => ({
  choice: { gap: spacing.sm },
  group: { gap: spacing.lg },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: colors.glassBorder },
}));

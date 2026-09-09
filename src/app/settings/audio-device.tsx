import { useState } from 'react';
import { Platform, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { AppPressable } from '@/components/AppPressable';
import { Text } from '@/components/Text';
import { SettingsCard, SettingsSectionLabel, SettingsSectionScreen } from '@/components/settings/SettingsSectionScaffold';
import { useAudioDiagnostics } from '@/audio/useAudioDiagnostics';
import { capabilityList, formatChannels, formatDiagnosticFormat, formatDiagnosticSource, formatEncoding, formatSampleRate, outputComparison, outputDescription } from '@/audio/audioDiagnostics';
import { useAudioSettingsStore } from '@/stores/audioSettingsStore';
import { usePlaybackTargetStore } from '@/stores/playbackTargetStore';
import { usePlayerStore } from '@/stores/playerStore';
import { spacing } from '@/theme';
import { createThemedStyles, useColors } from '@/theme/themed';

function Readout({ label, value }: { label: string; value: string }) {
  const styles = useStyles();
  const colors = useColors();
  return <View style={styles.readout}>
    <Text variant="caption" color={colors.textSecondary}>{label}</Text>
    <Text variant="body" selectable>{value}</Text>
  </View>;
}

const DEVICE_TYPES = {
  usb: 'USB audio', bluetooth: 'Bluetooth', wired: 'Wired headphones',
  speaker: 'Built-in speaker', hdmi: 'HDMI audio', remote: 'Remote audio', unknown: 'Audio output',
};

function gainLabel(value: number | null | undefined): string {
  return value != null && Number.isFinite(value) ? `${value > 0 ? '+' : ''}${value.toFixed(1)} dB` : 'Not reported';
}

export default function AudioDeviceScreen() {
  const styles = useStyles();
  const colors = useColors();
  const desktop = usePlaybackTargetStore((s) => s.target === 'desktop');
  const snapshot = useAudioDiagnostics(Platform.OS === 'android' && !desktop);
  const [details, setDetails] = useState(false);
  const normalization = useAudioSettingsStore((s) => s.normalizationEnabled);
  const targetLufs = useAudioSettingsStore((s) => s.normalizationTargetLufs);
  const replayGain = useAudioSettingsStore((s) => s.replayGainEnabled);
  const replayGainMode = useAudioSettingsStore((s) => s.replayGainMode);
  const restored = usePlayerStore((s) => s.restoredSessionPending);
  const comparison = outputComparison(snapshot);
  const capabilities = snapshot?.capabilities;
  const source = snapshot?.source;
  const pcmProfiles = capabilities?.profiles?.filter((p) => p.encoding?.startsWith('pcm-')) ?? [];

  if (desktop || Platform.OS !== 'android') {
    return <SettingsSectionScreen title="Audio device" backLabel="Audio">
      <SettingsCard>
        <Text variant="heading">{desktop ? 'Playback is on your desktop' : 'Device information unavailable'}</Text>
        <Text variant="body" color={colors.textSecondary} style={styles.note}>
          {desktop ? 'Audio device information is available for playback on this phone. The desktop’s output is not reported here.' : 'Audio device diagnostics are currently available on Android.'}
        </Text>
      </SettingsCard>
    </SettingsSectionScreen>;
  }

  return <SettingsSectionScreen title="Audio device" backLabel="Audio">
    <SettingsSectionLabel>DEVICE</SettingsSectionLabel>
    <SettingsCard>
      <View style={styles.device}>
        <Ionicons name={snapshot?.route?.kind === 'speaker' ? 'volume-high-outline' : 'headset-outline'} size={28} color={colors.accent} />
        <View style={styles.deviceText}>
          <Text variant="heading" selectable>{snapshot?.route?.label ?? 'Output not reported'}</Text>
          <Text variant="caption" color={colors.textSecondary}>{snapshot?.route ? DEVICE_TYPES[snapshot.route.kind] : 'Waiting for device information'}</Text>
        </View>
      </View>
    </SettingsCard>

    <SettingsSectionLabel spaced>CURRENT PLAYBACK</SettingsSectionLabel>
    <SettingsCard style={styles.stack}>
      <View style={styles.track}>
        <Text variant="heading">{source?.title ?? 'No track loaded'}</Text>
        {source?.artist ? <Text variant="caption" color={colors.textSecondary}>{source.artist}</Text> : null}
        <Text variant="caption" color={colors.textTertiary}>
          {restored && !source ? 'Saved session · playback has not started' : snapshot ? ({ playing: 'Playing', paused: 'Paused', loading: 'Buffering', stopped: 'Stopped', error: 'Playback unavailable' }[snapshot.state]) : 'Diagnostics unavailable'}
        </Text>
      </View>
      <Readout label="Source" value={formatDiagnosticSource(source ?? null)} />
      <Readout label="Astra output" value={outputDescription(snapshot)} />
      <Readout label="Device output" value="Not reported by Android" />
      {comparison ? <Text variant="caption" color={colors.accent}>{comparison}</Text> : null}
      <Text variant="caption" color={colors.textSecondary}>
        Astra output is the stream sent to Android. Android or your device may process it further; matching formats do not confirm bit-perfect playback.
      </Text>
    </SettingsCard>

    <SettingsSectionLabel spaced>REPORTED CAPABILITIES</SettingsSectionLabel>
    <SettingsCard style={styles.stack}>
      <Readout label="Sample rates" value={capabilityList(capabilities?.sampleRates, formatSampleRate)} />
      <Readout label="PCM formats" value={!capabilities ? 'Not reported' : capabilities.encodings.length === 0 ? 'No fixed list reported' : capabilities.encodings.filter((e) => e.startsWith('pcm-')).map(formatEncoding).join(' · ') || 'No PCM formats reported'} />
      <Readout label="Channels" value={capabilityList(capabilities?.channelCounts, formatChannels)} />
      <Text variant="caption" color={colors.textSecondary}>
        Reported by Android for this output. These lists describe Android’s audio interface and may not include every hardware capability or combination.
      </Text>
    </SettingsCard>

    <AppPressable style={styles.detailsToggle} accessibilityRole="button" accessibilityState={{ expanded: details }} onPress={() => setDetails((value) => !value)}>
      <Text variant="body">Technical details</Text>
      <Ionicons name={details ? 'chevron-up' : 'chevron-down'} size={20} color={colors.textSecondary} />
    </AppPressable>
    {details ? <SettingsCard style={styles.stack}>
      <Readout label="Route detection" value={snapshot?.routeProvenance === 'media-prediction' ? 'Predicted by Android for music playback' : snapshot?.routeProvenance === 'connected-device-fallback' ? 'Inferred from connected devices' : 'Not reported'} />
      <Readout label="Received stream" value={formatDiagnosticFormat(snapshot?.stream ?? null)} />
      <Readout label="Decoder" value={snapshot?.decoder ?? 'Not reported'} />
      <Readout label="Decoded / sink input" value={formatDiagnosticFormat(snapshot?.sinkInput ?? null)} />
      <Readout label="EQ setting" value={snapshot ? snapshot.processing.eqEnabled ? `On · preamp ${gainLabel(snapshot.processing.preampDb)}` : 'Off' : 'Not reported'} />
      <Readout label="Normalization setting" value={normalization ? `On · ${targetLufs} LUFS target` : 'Off'} />
      <Readout label="ReplayGain setting" value={replayGain ? `On · ${replayGainMode}` : 'Off'} />
      <Readout label="Native gain target" value={gainLabel(snapshot?.processing.gainTargetDb)} />
      <Text variant="caption" color={colors.textSecondary}>Processing settings describe Astra’s configuration. A gain target is not a measurement of the device’s output. Float PCM is a sample representation, not a claim of 32-bit integer precision.</Text>
      {pcmProfiles.length ? <View style={styles.stack}>
        <Text variant="label">Reported PCM profiles</Text>
        {pcmProfiles.map((profile, index) => <Readout key={`${profile.encoding}-${index}`} label={formatEncoding(profile.encoding)} value={`${capabilityList(profile.sampleRates, formatSampleRate)}\n${capabilityList(profile.channelCounts, formatChannels)}`} />)}
      </View> : <Readout label="Per-format profiles" value="Not reported" />}
      {capabilities?.encodings.some((e) => !e.startsWith('pcm-')) ? <Readout label="Other reported formats" value={capabilities.encodings.filter((e) => !e.startsWith('pcm-')).map(formatEncoding).join(' · ')} /> : null}
      <Text variant="caption" color={colors.textSecondary}>“Not reported” means the information is unavailable. “No fixed list reported” means Android does not enumerate fixed values. Lossy formats may not have a meaningful source bit depth. Bluetooth’s final codec and the DAC’s final format are not exposed here.</Text>
    </SettingsCard> : null}
  </SettingsSectionScreen>;
}

const useStyles = createThemedStyles(() => ({
  stack: { gap: spacing.lg },
  readout: { gap: spacing.xs },
  track: { gap: spacing.xs, marginBottom: spacing.xs },
  note: { marginTop: spacing.md },
  device: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  deviceText: { flex: 1, minWidth: 0, gap: spacing.xs },
  detailsToggle: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: spacing.lg, gap: spacing.md },
}));

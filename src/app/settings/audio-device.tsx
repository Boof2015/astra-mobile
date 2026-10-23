import { useState, type ReactNode } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { AppPressable } from '@/components/AppPressable';
import { Badge } from '@/components/FormatBadge';
import { Text } from '@/components/Text';
import { SettingsCard, SettingsSectionLabel, SettingsSectionScreen } from '@/components/settings/SettingsSectionScaffold';
import { useAudioDiagnostics } from '@/audio/useAudioDiagnostics';
import { channelBadge, compareOutput, deviceOutputPath, encodingBadge, formatBadges, formatChannels, formatDiagnosticFormat, formatEncoding, formatSampleRate, capabilityList, mixerEncodings, mixerSupport, outputDescription, sourceBadges, type AudioDiagnosticsSnapshot } from '@/audio/audioDiagnostics';
import { useAudioSettingsStore } from '@/stores/audioSettingsStore';
import { usePlaybackTargetStore } from '@/stores/playbackTargetStore';
import { usePlayerStore } from '@/stores/playerStore';
import { radius, spacing } from '@/theme';
import { createThemedStyles, useColors } from '@/theme/themed';

const DEVICE_TYPES = {
  usb: 'USB audio', bluetooth: 'Bluetooth', wired: 'Wired headphones',
  speaker: 'Built-in speaker', hdmi: 'HDMI audio', remote: 'Remote audio', unknown: 'Audio output',
};

const STATE_LABELS = { playing: 'PLAYING', paused: 'PAUSED', loading: 'BUFFERING', stopped: 'STOPPED', error: 'UNAVAILABLE' };

// Signal-path rail. The body's left border is the connector; its margin and padding put the
// line under the dot's center and the body text under the stage title.
const DOT = 10;
const LINE = 2;
const DOT_GAP = spacing.md;

function gainLabel(value: number | null | undefined): string {
  return value != null && Number.isFinite(value) ? `${value > 0 ? '+' : ''}${value.toFixed(1)} dB` : 'Not reported';
}

function Badges({ values, empty }: { values: string[]; empty?: string }) {
  const styles = useStyles();
  const colors = useColors();
  if (!values.length) return empty ? <Text variant="caption" color={colors.textSecondary}>{empty}</Text> : null;
  return <View style={styles.badges}>{values.map((value) => <Badge key={value} label={value} />)}</View>;
}

function Stage({ title, detail, badges, empty, last = false }: { title: string; detail?: string | null; badges: string[]; empty?: string; last?: boolean }) {
  const styles = useStyles();
  const colors = useColors();
  const reported = badges.length > 0;
  return <View>
    <View style={styles.stageHead}>
      <View style={[styles.dot, reported ? styles.dotReported : styles.dotMissing]} />
      <Text variant="label" color={colors.textSecondary}>{title}</Text>
    </View>
    <View style={[styles.stageBody, last ? styles.stageBodyLast : null]}>
      {detail ? <Text variant="caption" color={colors.textSecondary} numberOfLines={2}>{detail}</Text> : null}
      <Badges values={badges} empty={empty} />
    </View>
  </View>;
}

function CapabilityRow({ label, values, empty }: { label: string; values: string[] | null; empty: string }) {
  const styles = useStyles();
  const colors = useColors();
  return <View style={styles.capability}>
    <Text variant="caption" color={colors.textSecondary}>{label}</Text>
    <Badges values={values ?? []} empty={values == null ? 'Not reported' : empty} />
  </View>;
}

function DetailGroup({ title, children }: { title: string; children: ReactNode }) {
  const styles = useStyles();
  const colors = useColors();
  return <View style={styles.group}>
    <Text variant="label" color={colors.textTertiary} style={styles.groupTitle}>{title}</Text>
    {children}
  </View>;
}

function DetailRow({ label, value }: { label: string; value: string }) {
  const styles = useStyles();
  const colors = useColors();
  return <View style={styles.detailRow}>
    <Text variant="caption" color={colors.textSecondary} style={styles.detailLabel}>{label}</Text>
    <Text variant="caption" style={styles.detailValue} selectable>{value}</Text>
  </View>;
}

function astraOutput(snapshot: AudioDiagnosticsSnapshot | null): { detail: string | null; badges: string[] } {
  const observed = snapshot?.outputStatus === 'observed' && (snapshot.state === 'playing' || snapshot.state === 'paused');
  if (!observed) return { detail: outputDescription(snapshot), badges: [] };
  return { detail: snapshot.state === 'paused' ? 'Paused configuration' : null, badges: formatBadges(snapshot.output) };
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

  const route = snapshot?.route;
  const source = snapshot?.source ?? null;
  const capabilities = snapshot?.capabilities;
  const comparison = compareOutput(snapshot);
  const astra = astraOutput(snapshot);
  const androidPath = deviceOutputPath(snapshot);
  const androidBadges = snapshot?.deviceOutput?.path === 'vendor' ? [] : formatBadges(snapshot?.deviceOutput ?? null);
  const sourceDetail = source
    ? [source.title, source.artist].filter(Boolean).join(' — ') || null
    : restored ? 'Saved session · playback has not started' : null;
  const pcmProfiles = capabilities?.profiles?.filter((p) => p.encoding?.startsWith('pcm-')) ?? [];
  const pcmEncodings = capabilities ? capabilities.encodings.map(encodingBadge).filter((e): e is string => !!e && e !== 'ENCODED') : null;
  const otherFormats = capabilities?.encodings.filter((e) => !e.startsWith('pcm-')) ?? [];
  const matchFormats = mixerEncodings(snapshot, 'match');
  const bitPerfectFormats = mixerEncodings(snapshot, 'bit-perfect');

  return <SettingsSectionScreen title="Audio device" backLabel="Audio">
    <SettingsCard style={styles.device}>
      <View style={styles.deviceIcon}>
        <Ionicons name={route?.kind === 'speaker' ? 'volume-high-outline' : route?.kind === 'bluetooth' ? 'bluetooth-outline' : 'headset-outline'} size={24} color={colors.accent} />
      </View>
      <View style={styles.deviceText}>
        <Text variant="heading" numberOfLines={2} selectable>{route?.label ?? 'Output not reported'}</Text>
        <Text variant="caption" color={colors.textSecondary}>{route ? DEVICE_TYPES[route.kind] : 'Waiting for device information'}</Text>
      </View>
    </SettingsCard>

    <SettingsSectionLabel spaced>{snapshot ? `SIGNAL PATH · ${STATE_LABELS[snapshot.state]}` : 'SIGNAL PATH'}</SettingsSectionLabel>
    <SettingsCard>
      <Stage title="Source" detail={sourceDetail} badges={sourceBadges(source)} empty={source ? 'Format not reported' : restored ? undefined : 'No track loaded'} />
      <Stage title="Astra output" detail={astra.detail} badges={astra.badges} />
      <Stage title="Android output" detail={androidPath} badges={androidBadges} empty={androidPath ? undefined : 'Not reported'} last />
      {comparison ? <View style={styles.verdict}>
        <Ionicons name={comparison.changed ? 'swap-horizontal' : 'checkmark-circle-outline'} size={16} color={comparison.changed ? colors.warning : colors.accent} />
        <Text variant="caption" color={comparison.changed ? colors.warning : colors.accent} style={styles.verdictText}>{comparison.text}</Text>
      </View> : null}
    </SettingsCard>
    <Text variant="caption" color={colors.textTertiary} style={styles.footnote}>Matching formats don’t confirm bit-perfect playback; your DAC or a Bluetooth codec may convert again.</Text>

    <SettingsSectionLabel spaced>THIS OUTPUT ACCEPTS</SettingsSectionLabel>
    <SettingsCard style={styles.stack}>
      <CapabilityRow label="Sample rates" values={capabilities ? capabilities.sampleRates.map(formatSampleRate) : null} empty="No fixed list reported" />
      <CapabilityRow label="PCM formats" values={pcmEncodings} empty={capabilities?.encodings.length ? 'No PCM formats reported' : 'No fixed list reported'} />
      <CapabilityRow label="Channels" values={capabilities ? capabilities.channelCounts.map(channelBadge) : null} empty="No fixed list reported" />
    </SettingsCard>
    <Text variant="caption" color={colors.textTertiary} style={styles.footnote}>
      As reported by Android, which may not list every hardware mode.
      {route?.kind === 'bluetooth' ? ' Bluetooth sets its sample rate when it connects, so no app can change it per track.' : ''}
    </Text>

    <AppPressable style={styles.detailsToggle} accessibilityRole="button" accessibilityState={{ expanded: details }} onPress={() => setDetails((value) => !value)}>
      <Text variant="body">Technical details</Text>
      <Ionicons name={details ? 'chevron-up' : 'chevron-down'} size={20} color={colors.textSecondary} />
    </AppPressable>
    {details ? <SettingsCard style={styles.details}>
      <DetailGroup title="PLAYBACK">
        <DetailRow label="Route detection" value={snapshot?.routeProvenance === 'media-prediction' ? 'Predicted by Android for music' : snapshot?.routeProvenance === 'connected-device-fallback' ? 'Inferred from connected devices' : 'Not reported'} />
        <DetailRow label="Received stream" value={formatDiagnosticFormat(snapshot?.stream ?? null)} />
        <DetailRow label="Decoder" value={snapshot?.decoder ?? 'Not reported'} />
        <DetailRow label="Decoded / sink input" value={formatDiagnosticFormat(snapshot?.sinkInput ?? null)} />
      </DetailGroup>
      <DetailGroup title="PROCESSING">
        <DetailRow label="EQ" value={snapshot ? snapshot.processing.eqEnabled ? `On · preamp ${gainLabel(snapshot.processing.preampDb)}` : 'Off' : 'Not reported'} />
        <DetailRow label="Normalization" value={normalization ? `On · ${targetLufs} LUFS target` : 'Off'} />
        <DetailRow label="ReplayGain" value={replayGain ? `On · ${replayGainMode}` : 'Off'} />
        <DetailRow label="Native gain target" value={gainLabel(snapshot?.processing.gainTargetDb)} />
      </DetailGroup>
      <DetailGroup title="ANDROID 14 USB OPTIONS">
        <DetailRow label="Sample-rate matching" value={matchFormats ? `${mixerSupport(snapshot, 'match')}\n${matchFormats}` : mixerSupport(snapshot, 'match')} />
        <DetailRow label="Bit-perfect" value={bitPerfectFormats ? `${mixerSupport(snapshot, 'bit-perfect')}\n${bitPerfectFormats}` : mixerSupport(snapshot, 'bit-perfect')} />
      </DetailGroup>
      <DetailGroup title="REPORTED PCM PROFILES">
        {pcmProfiles.length
          ? pcmProfiles.map((profile, index) => <DetailRow key={`${profile.encoding}-${index}`} label={formatEncoding(profile.encoding)} value={`${capabilityList(profile.sampleRates, formatSampleRate)}\n${capabilityList(profile.channelCounts, formatChannels)}`} />)
          : <DetailRow label="Per-format profiles" value="Not reported" />}
        {otherFormats.length ? <DetailRow label="Other formats" value={otherFormats.map(formatEncoding).join(' · ')} /> : null}
      </DetailGroup>
      <Text variant="caption" color={colors.textTertiary}>
        “Not reported” means Android doesn’t expose it. USB options show what this phone offers; Astra leaves the output format to Android. Float PCM is a sample representation, not 32-bit integer precision, and a gain target is a setting, not a measurement.
      </Text>
    </SettingsCard> : null}
  </SettingsSectionScreen>;
}

const useStyles = createThemedStyles((colors) => ({
  stack: { gap: spacing.lg },
  note: { marginTop: spacing.md },
  footnote: { marginTop: spacing.xs, paddingHorizontal: spacing.xs },
  device: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  deviceIcon: {
    width: 44, height: 44, borderRadius: radius.md,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.bgTertiary,
  },
  deviceText: { flex: 1, minWidth: 0, gap: 2 },
  stageHead: { flexDirection: 'row', alignItems: 'center', gap: DOT_GAP },
  dot: { width: DOT, height: DOT, borderRadius: DOT / 2 },
  dotReported: { backgroundColor: colors.accent },
  dotMissing: { borderWidth: LINE, borderColor: colors.textTertiary },
  stageBody: {
    marginLeft: (DOT - LINE) / 2,
    borderLeftWidth: LINE,
    borderLeftColor: colors.glassBorderStrong,
    paddingLeft: DOT / 2 + DOT_GAP - LINE / 2,
    paddingTop: spacing.xs,
    paddingBottom: spacing.lg,
    gap: spacing.sm,
  },
  stageBodyLast: { borderLeftColor: 'transparent', paddingBottom: 0 },
  badges: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  verdict: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    marginTop: spacing.lg, paddingTop: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.glassBorder,
  },
  verdictText: { flex: 1, minWidth: 0 },
  capability: { gap: spacing.sm },
  detailsToggle: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: spacing.lg, marginTop: spacing.md, gap: spacing.md },
  details: { gap: spacing.lg },
  group: { gap: spacing.sm },
  groupTitle: { letterSpacing: 1 },
  detailRow: {
    flexDirection: 'row', gap: spacing.md,
    paddingTop: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.glassBorder,
  },
  detailLabel: { flex: 2, minWidth: 0 },
  detailValue: { flex: 3, minWidth: 0 },
}));

import { useEffect } from 'react';
import { View, Pressable, ScrollView, StyleSheet, Switch } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { Screen } from '@/components/Screen';
import { Text } from '@/components/Text';
import { EQSlider } from '@/components/eq/EQSlider';
import { colors, radius, spacing } from '@/theme';
import { useSettingsStore } from '@/stores/settingsStore';
import { useAudioSettingsStore } from '@/stores/audioSettingsStore';
import { useRemoteSourcesStore } from '@/stores/remoteSourcesStore';
import { useLastFmSettingsStore } from '@/stores/lastFmSettingsStore';
import { useDesktopRemoteStore } from '@/stores/desktopRemoteStore';
import type { ReplayGainMode } from '@/audio/normalization';
import type { ArtistGroupingMode } from '@/library/artistGrouping';
import type { LastFmStatus } from '@/types/lastFm';

function lastFmScrobbleSubtitle(status: LastFmStatus | null): string {
  const connected = status?.profiles.filter((p) => p.connected).length ?? 0;
  if (connected === 0) return 'Scrobble plays to Last.fm, ListenBrainz, and more.';
  const base = `${connected} destination${connected === 1 ? '' : 's'} connected`;
  return status?.enabled ? `${base}.` : `${base} · paused.`;
}

const ARTIST_GROUPING_OPTIONS: { mode: ArtistGroupingMode; title: string; description: string }[] = [
  {
    mode: 'astra',
    title: 'Astra grouping',
    description: 'Parse collaborators ("feat.", "&", "x") — featured artists get their own entry.',
  },
  {
    mode: 'fileTags',
    title: 'File tags',
    description: 'Group by the album artist / artist tag exactly as written.',
  },
];

const REPLAYGAIN_MODES: { mode: ReplayGainMode; label: string }[] = [
  { mode: 'auto', label: 'Auto' },
  { mode: 'track', label: 'Track' },
  { mode: 'album', label: 'Album' },
];

function ToggleRow({
  title,
  description,
  value,
  onValueChange,
}: {
  title: string;
  description: string;
  value: boolean;
  onValueChange: (v: boolean) => void;
}) {
  return (
    <View style={styles.toggleRow}>
      <View style={styles.toggleText}>
        <Text variant="body">{title}</Text>
        <Text variant="caption" color={colors.textSecondary} style={styles.optionDescription}>
          {description}
        </Text>
      </View>
      <Switch
        value={value}
        onValueChange={onValueChange}
        trackColor={{ false: colors.glassBorder, true: colors.accent }}
        thumbColor={colors.textPrimary}
      />
    </View>
  );
}

export default function SettingsScreen() {
  const router = useRouter();
  const remoteSources = useRemoteSourcesStore((s) => s.sources);
  const lastFmStatus = useLastFmSettingsStore((s) => s.status);
  const desktopRemoteConnection = useDesktopRemoteStore((s) => s.connection);
  const desktopRemoteState = useDesktopRemoteStore((s) => s.connectionState);
  const initDesktopRemote = useDesktopRemoteStore((s) => s.init);

  const groupingMode = useSettingsStore((s) => s.artistGroupingMode);
  const setArtistGroupingMode = useSettingsStore((s) => s.setArtistGroupingMode);

  const normalizationEnabled = useAudioSettingsStore((s) => s.normalizationEnabled);
  const normalizationTargetLufs = useAudioSettingsStore((s) => s.normalizationTargetLufs);
  const replayGainEnabled = useAudioSettingsStore((s) => s.replayGainEnabled);
  const replayGainMode = useAudioSettingsStore((s) => s.replayGainMode);
  const setNormalizationEnabled = useAudioSettingsStore((s) => s.setNormalizationEnabled);
  const setNormalizationTargetLufs = useAudioSettingsStore((s) => s.setNormalizationTargetLufs);
  const setReplayGainEnabled = useAudioSettingsStore((s) => s.setReplayGainEnabled);
  const setReplayGainMode = useAudioSettingsStore((s) => s.setReplayGainMode);

  useEffect(() => {
    void initDesktopRemote();
  }, [initDesktopRemote]);

  const desktopRemoteSubtitle = desktopRemoteConnection
    ? `${desktopRemoteConnection.desktopName ?? 'Astra Desktop'} · ${desktopRemoteState === 'connected' ? 'connected' : desktopRemoteState}`
    : 'Pair with Astra Desktop to control playback from this phone.';

  return (
    <Screen>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
        <Text variant="title" style={styles.heading}>
          Settings
        </Text>

        <Text variant="label" color={colors.textTertiary} style={styles.sectionLabel}>
          AUDIO
        </Text>
        <View style={styles.card}>
          <ToggleRow
            title="Loudness normalization"
            description="Level every track to a target loudness — easier on your ears and keeps the scopes consistent."
            value={normalizationEnabled}
            onValueChange={(v) => void setNormalizationEnabled(v)}
          />
          {normalizationEnabled ? (
            <View style={styles.indent}>
              <EQSlider
                label="Target"
                value={normalizationTargetLufs}
                min={-30}
                max={-5}
                format={(v) => `${Math.round(v)} LUFS`}
                onChange={(v) => void setNormalizationTargetLufs(Math.round(v))}
              />
            </View>
          ) : null}
        </View>

        <View style={[styles.card, styles.cardSpacing]}>
          <ToggleRow
            title="ReplayGain"
            description="Use ReplayGain tags when present; falls back to the measured loudness above."
            value={replayGainEnabled}
            onValueChange={(v) => void setReplayGainEnabled(v)}
          />
          {replayGainEnabled ? (
            <View style={styles.modeRow}>
              {REPLAYGAIN_MODES.map((m) => {
                const selected = m.mode === replayGainMode;
                return (
                  <Pressable
                    key={m.mode}
                    style={[styles.modePill, selected && styles.modePillSelected]}
                    onPress={() => void setReplayGainMode(m.mode)}
                  >
                    <Text variant="label" color={selected ? colors.accentTextStrong : colors.textSecondary}>
                      {m.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          ) : null}
        </View>

        <Text variant="label" color={colors.textTertiary} style={[styles.sectionLabel, styles.sectionSpacing]}>
          LIBRARY
        </Text>
        <Text variant="body" style={styles.settingTitle}>
          Artist grouping
        </Text>
        <Text variant="caption" color={colors.textSecondary} style={styles.settingNote}>
          How tracks are organized into artists in the library.
        </Text>

        <View style={styles.options}>
          {ARTIST_GROUPING_OPTIONS.map((option) => {
            const selected = option.mode === groupingMode;
            return (
              <Pressable
                key={option.mode}
                style={[styles.option, selected && styles.optionSelected]}
                onPress={() => void setArtistGroupingMode(option.mode)}
                accessibilityRole="radio"
                accessibilityState={{ selected }}
              >
                <View style={styles.optionText}>
                  <Text variant="body" color={selected ? colors.accentTextStrong : colors.textPrimary}>
                    {option.title}
                  </Text>
                  <Text variant="caption" color={colors.textSecondary} style={styles.optionDescription}>
                    {option.description}
                  </Text>
                </View>
                {selected ? (
                  <Ionicons name="checkmark-circle" size={20} color={colors.accent} />
                ) : (
                  <Ionicons name="ellipse-outline" size={20} color={colors.textTertiary} />
                )}
              </Pressable>
            );
          })}
        </View>

        <Text variant="label" color={colors.textTertiary} style={[styles.sectionLabel, styles.sectionSpacing]}>
          REMOTE SOURCES
        </Text>
        <Pressable
          style={styles.option}
          onPress={() => router.push('/sources')}
          accessibilityRole="button"
        >
          <Ionicons name="server-outline" size={20} color={colors.textSecondary} />
          <View style={styles.optionText}>
            <Text variant="body">Subsonic / Jellyfin servers</Text>
            <Text variant="caption" color={colors.textSecondary} style={styles.optionDescription}>
              {remoteSources.length === 0
                ? 'Stream and browse your self-hosted library.'
                : `${remoteSources.length} server${remoteSources.length === 1 ? '' : 's'} connected.`}
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={colors.textTertiary} />
        </Pressable>

        <Text variant="label" color={colors.textTertiary} style={[styles.sectionLabel, styles.sectionSpacing]}>
          EXPERIMENTAL
        </Text>
        <Pressable
          style={styles.option}
          onPress={() => router.push('/desktop-remote' as never)}
          accessibilityRole="button"
        >
          <Ionicons name="phone-portrait-outline" size={20} color={colors.textSecondary} />
          <View style={styles.optionText}>
            <Text variant="body">Desktop Remote</Text>
            <Text variant="caption" color={colors.textSecondary} style={styles.optionDescription}>
              {desktopRemoteSubtitle}
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={colors.textTertiary} />
        </Pressable>

        <Text
          variant="label"
          color={colors.textTertiary}
          style={[styles.sectionLabel, styles.sectionSpacing]}
        >
          SCROBBLING
        </Text>
        <Pressable
          style={styles.option}
          onPress={() => router.push('/lastfm')}
          accessibilityRole="button"
        >
          <Ionicons name="radio-outline" size={20} color={colors.textSecondary} />
          <View style={styles.optionText}>
            <Text variant="body">Last.fm &amp; scrobbling</Text>
            <Text variant="caption" color={colors.textSecondary} style={styles.optionDescription}>
              {lastFmScrobbleSubtitle(lastFmStatus)}
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={colors.textTertiary} />
        </Pressable>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingBottom: spacing.xxl,
  },
  heading: {
    marginTop: spacing.xl,
    marginBottom: spacing.xxl,
  },
  sectionLabel: {
    letterSpacing: 1,
    marginBottom: spacing.sm,
  },
  sectionSpacing: {
    marginTop: spacing.xxl,
  },
  card: {
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glassBorder,
    backgroundColor: colors.glassBg,
    padding: spacing.lg,
  },
  cardSpacing: {
    marginTop: spacing.sm,
  },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  toggleText: {
    flex: 1,
    gap: 2,
  },
  indent: {
    marginTop: spacing.sm,
  },
  modeRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  modePill: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glassBorder,
  },
  modePillSelected: {
    borderColor: colors.accent,
    backgroundColor: colors.accentGlow,
  },
  settingTitle: {
    marginBottom: spacing.xs,
  },
  settingNote: {
    marginBottom: spacing.md,
  },
  options: {
    gap: spacing.sm,
  },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.lg,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glassBorder,
    backgroundColor: colors.glassBg,
  },
  optionSelected: {
    borderColor: colors.accent,
    backgroundColor: colors.glassHighlight,
  },
  optionText: {
    flex: 1,
    gap: 2,
  },
  optionDescription: {
    lineHeight: 16,
  },
});

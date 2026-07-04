import { useEffect } from 'react';
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  View
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { Screen } from '@/components/Screen';
import { Text } from '@/components/Text';
import {
  colors,
  radius,
  spacing
} from '@/theme';
import { useLastFmSettingsStore } from '@/stores/lastFmSettingsStore';
import { requestLastFmFlush } from '@/services/lastfm';
import type { LastFmProfileStatus } from '@/types/lastFm';

function profileIcon(profile: LastFmProfileStatus): keyof typeof Ionicons.glyphMap {
  if (profile.protocol === 'listenbrainz') return 'headset-outline';
  if (profile.kind === 'official') return 'radio-outline';
  return 'git-network-outline';
}

function queuedLabel(n: number): string {
  return `${n} scrobble${n === 1 ? '' : 's'} queued — will retry`;
}

/** Subtitle for a custom destination row (username is shown inline for official). */
function customStatusLine(profile: LastFmProfileStatus): { text: string; tone: 'normal' | 'error' } {
  if (profile.connected) {
    const who = profile.username ? `Connected as ${profile.username}` : 'Token configured';
    // Queued scrobbles take priority over a transient error — they're cached, not lost.
    if (profile.pendingScrobbles > 0) return { text: `${who} · ${queuedLabel(profile.pendingScrobbles)}`, tone: 'normal' };
    if (profile.lastError) return { text: profile.lastError, tone: 'error' };
    return { text: `${who}${profile.enabled ? '' : ' · paused'}`, tone: 'normal' };
  }
  if (profile.lastError) return { text: profile.lastError, tone: 'error' };
  return { text: 'Needs credentials — tap to fix', tone: 'normal' };
}

export default function LastFmScreen() {
  const router = useRouter();
  const status = useLastFmSettingsStore((s) => s.status);
  const authHint = useLastFmSettingsStore((s) => s.authHint);
  const errorMessage = useLastFmSettingsStore((s) => s.errorMessage);
  const init = useLastFmSettingsStore((s) => s.init);
  const setEnabled = useLastFmSettingsStore((s) => s.setEnabled);
  const beginAuth = useLastFmSettingsStore((s) => s.beginAuth);
  const setProfileEnabled = useLastFmSettingsStore((s) => s.setProfileEnabled);
  const disconnectProfile = useLastFmSettingsStore((s) => s.disconnectProfile);

  useEffect(() => {
    void init();
  }, [init]);

  const profiles = status?.profiles ?? [];

  const connectOfficial = (profile: LastFmProfileStatus) => {
    if (status && !status.hasApiCredentials) {
      Alert.alert(
        'Last.fm not configured',
        'This build has no Last.fm API key. Set EXPO_PUBLIC_LASTFM_API_KEY / _SHARED_SECRET, or add a custom Last.fm-compatible / ListenBrainz destination instead.'
      );
      return;
    }
    void beginAuth(profile.id);
  };

  const confirmDisconnect = (profile: LastFmProfileStatus) => {
    Alert.alert(`Disconnect ${profile.name}?`, 'Astra will stop scrobbling to this destination.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Disconnect',
        style: 'destructive',
        onPress: () => void disconnectProfile(profile.id),
      },
    ]);
  };

  const renderOfficial = (profile: LastFmProfileStatus) => {
    const subtitle = profile.connected
      ? profile.pendingScrobbles > 0
        ? queuedLabel(profile.pendingScrobbles)
        : profile.lastError
          ? profile.lastError
          : 'Scrobbling enabled'
      : profile.requiresApiCredentials && status && !status.hasApiCredentials
        ? 'Last.fm API key not set in this build'
        : 'Not connected';
    const subtitleError = profile.pendingScrobbles === 0 && !!profile.lastError;

    return (
      <View key={profile.id} style={styles.row}>
        <View style={styles.rowIcon}>
          <Ionicons name={profileIcon(profile)} size={20} color={colors.accent} />
        </View>
        <View style={styles.rowMeta}>
          <View style={styles.rowTitleLine}>
            <Text variant="body" numberOfLines={1} style={styles.rowName}>
              {profile.name}
            </Text>
            <Text variant="label" color={colors.textTertiary}>
              {profile.protocolLabel}
            </Text>
          </View>
          <Text
            variant="caption"
            color={subtitleError ? colors.warning : colors.textSecondary}
            numberOfLines={2}
          >
            {subtitle}
          </Text>
        </View>
        {profile.connected ? (
          <View style={styles.linkedRight}>
            {profile.username ? (
              <Text variant="caption" color={colors.accentText} numberOfLines={1} style={styles.linkedUser}>
                {profile.username}
              </Text>
            ) : null}
            <Pressable
              onPress={() => confirmDisconnect(profile)}
              hitSlop={8}
              accessibilityLabel="Disconnect Last.fm"
            >
              <Ionicons name="close-circle" size={22} color={colors.textTertiary} />
            </Pressable>
          </View>
        ) : (
          <Pressable
            style={styles.connectButton}
            onPress={() => connectOfficial(profile)}
            accessibilityRole="button"
          >
            <Ionicons name="link" size={16} color={colors.accentTextStrong} />
            <Text variant="label" color={colors.accentTextStrong}>
              Connect
            </Text>
          </Pressable>
        )}
      </View>
    );
  };

  const renderCustom = (profile: LastFmProfileStatus) => {
    const line = customStatusLine(profile);
    return (
      <Pressable
        key={profile.id}
        style={styles.row}
        onPress={() => router.push({ pathname: '/lastfm/edit', params: { id: profile.id } })}
        accessibilityRole="button"
      >
        <View style={styles.rowIcon}>
          <Ionicons name={profileIcon(profile)} size={20} color={colors.accent} />
        </View>
        <View style={styles.rowMeta}>
          <View style={styles.rowTitleLine}>
            <Text variant="body" numberOfLines={1} style={styles.rowName}>
              {profile.name}
            </Text>
            <Text variant="label" color={colors.textTertiary}>
              {profile.protocolLabel}
            </Text>
          </View>
          <Text
            variant="caption"
            color={line.tone === 'error' ? colors.warning : colors.textSecondary}
            numberOfLines={2}
          >
            {line.text}
          </Text>
        </View>
        {profile.connected ? (
          <Switch
            value={profile.enabled}
            onValueChange={(v) => void setProfileEnabled(profile.id, v)}
            trackColor={{ false: colors.glassBorder, true: colors.accent }}
            thumbColor={colors.textPrimary}
          />
        ) : (
          <Ionicons name="chevron-forward" size={18} color={colors.textTertiary} />
        )}
      </Pressable>
    );
  };

  return (
    <Screen>
      <View style={styles.header}>
        <Pressable style={styles.back} onPress={() => router.back()} hitSlop={8}>
          <Ionicons name="chevron-back" size={22} color={colors.textSecondary} />
          <Text variant="body" color={colors.textSecondary}>
            Settings
          </Text>
        </Pressable>
        <Pressable
          onPress={() => router.push('/lastfm/edit')}
          hitSlop={8}
          accessibilityLabel="Add destination"
        >
          <Ionicons name="add" size={26} color={colors.accent} />
        </Pressable>
      </View>

      <Text variant="title" style={styles.heading}>
        Scrobbling
      </Text>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
        <View style={styles.card}>
          <View style={styles.toggleRow}>
            <View style={styles.toggleText}>
              <Text variant="body">Enable scrobbling</Text>
              <Text variant="caption" color={colors.textSecondary} style={styles.description}>
                Submit played tracks + &quot;now playing&quot; to your connected destinations.
              </Text>
            </View>
            <Switch
              value={status?.enabled ?? false}
              onValueChange={(v) => void setEnabled(v)}
              trackColor={{ false: colors.glassBorder, true: colors.accent }}
              thumbColor={colors.textPrimary}
            />
          </View>
        </View>

        {status?.statusMessage ? (
          <Text variant="caption" color={colors.textSecondary} style={styles.statusMessage}>
            {status.statusMessage}
          </Text>
        ) : null}
        {authHint ? (
          <Text variant="caption" color={colors.accent} style={styles.statusMessage}>
            {authHint}
          </Text>
        ) : null}
        {errorMessage ? (
          <Text variant="caption" color={colors.warning} style={styles.statusMessage}>
            {errorMessage}
          </Text>
        ) : null}

        {status && status.pendingScrobbles > 0 ? (
          <Pressable style={styles.retryButton} onPress={() => requestLastFmFlush()}>
            <Ionicons name="sync" size={16} color={colors.accentText} />
            <Text variant="label" color={colors.accentText}>
              Retry {status.pendingScrobbles} queued now
            </Text>
          </Pressable>
        ) : null}

        <Text
          variant="label"
          color={colors.textTertiary}
          style={[styles.sectionLabel, styles.sectionSpacing]}
        >
          DESTINATIONS
        </Text>

        <View style={styles.list}>
          {profiles.map((profile) =>
            profile.kind === 'official' ? renderOfficial(profile) : renderCustom(profile)
          )}
        </View>

        <Pressable style={styles.addButton} onPress={() => router.push('/lastfm/edit')}>
          <Ionicons name="add" size={18} color={colors.accentTextStrong} />
          <Text variant="body" color={colors.accentTextStrong}>
            Add destination
          </Text>
        </Pressable>

        <Text variant="caption" color={colors.textTertiary} style={styles.footnote}>
          A scrobble is sent once a track plays past half its length (or 4 minutes). Tracks under 30
          seconds are skipped. Failed scrobbles queue offline and retry automatically.
        </Text>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: spacing.md,
  },
  back: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  heading: {
    marginTop: spacing.lg,
    marginBottom: spacing.lg,
  },
  content: {
    paddingBottom: spacing.xxl,
  },
  card: {
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glassBorder,
    backgroundColor: colors.glassBg,
    padding: spacing.lg,
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
  description: {
    lineHeight: 16,
  },
  statusMessage: {
    marginTop: spacing.md,
    lineHeight: 18,
  },
  retryButton: {
    flexDirection: 'row',
    alignSelf: 'flex-start',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glassBorder,
    backgroundColor: colors.glassBg,
    marginTop: spacing.md,
  },
  sectionLabel: {
    letterSpacing: 1,
    marginBottom: spacing.sm,
  },
  sectionSpacing: {
    marginTop: spacing.xxl,
  },
  list: {
    gap: spacing.sm,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.lg,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glassBorder,
    backgroundColor: colors.glassBg,
  },
  rowIcon: {
    width: 36,
    height: 36,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.bgTertiary,
  },
  rowMeta: {
    flex: 1,
    gap: 2,
  },
  rowTitleLine: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  rowName: {
    flex: 1,
  },
  linkedRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    maxWidth: 150,
  },
  linkedUser: {
    flexShrink: 1,
  },
  connectButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    backgroundColor: colors.accent,
  },
  addButton: {
    flexDirection: 'row',
    alignSelf: 'flex-start',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.accent,
    backgroundColor: colors.accentGlow,
    marginTop: spacing.lg,
  },
  footnote: {
    marginTop: spacing.xl,
    lineHeight: 16,
  },
});

import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '@/components/Text';
import { ScanProgress } from '@/components/library/ScanProgress';
import {
  SettingsSectionLabel,
  SettingsSectionScreen,
  type SettingsIconName,
} from '@/components/settings/SettingsSectionScaffold';
import { openLibraryDb } from '@/db/database';
import { getLyricsCacheCount } from '@/db/lyricsQueries';
import { getWaveformCacheCount } from '@/db/waveformQueries';
import { clearAllLyricsCache } from '@/lyrics/lyrics';
import { clearAllWaveformCache } from '@/scope/waveform';
import { useLyricsStore } from '@/stores/lyricsStore';
import { useLibraryStore } from '@/stores/libraryStore';
import { useOnboardingStore } from '@/stores/onboardingStore';
import { radius, spacing } from '@/theme';
import { createThemedStyles, useColors } from '@/theme/themed';
import { SCROLL_PRESS_DELAY, useRipple } from '@/theme/ripple';

type ActionKey = 'scan' | 'rebuild' | 'lyrics' | 'waveform' | 'onboarding';

interface CacheCounts {
  lyrics: number;
  waveforms: number;
}

function countLabel(count: number | null, noun: string): string {
  if (count === null) return 'Counting cached entries…';
  return `${count} cached ${noun}${count === 1 ? '' : 's'}.`;
}

export default function TroubleshootingSettingsScreen() {
  const styles = useStyles();
  const colors = useColors();
  const isScanning = useLibraryStore((s) => s.isScanning);
  const [runningAction, setRunningAction] = useState<ActionKey | null>(null);
  const [feedback, setFeedback] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);
  const [counts, setCounts] = useState<CacheCounts | null>(null);
  const disabled = isScanning || runningAction !== null;

  const refreshCounts = useCallback(async () => {
    const db = await openLibraryDb();
    const [lyrics, waveforms] = await Promise.all([
      getLyricsCacheCount(db),
      getWaveformCacheCount(db),
    ]);
    setCounts({ lyrics, waveforms });
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      void refreshCounts().catch(() => setCounts({ lyrics: 0, waveforms: 0 }));
    }, 0);
    return () => clearTimeout(timer);
  }, [refreshCounts]);

  const run = async (key: ActionKey, action: () => Promise<void>, success: string) => {
    if (disabled) return;
    setRunningAction(key);
    setFeedback(null);
    try {
      await action();
      const scanError = useLibraryStore.getState().scanError;
      if ((key === 'scan' || key === 'rebuild') && scanError) throw new Error(scanError);
      setFeedback({ kind: 'success', text: success });
      await refreshCounts();
    } catch (error) {
      setFeedback({
        kind: 'error',
        text: error instanceof Error ? error.message : 'The maintenance action failed.',
      });
    } finally {
      setRunningAction(null);
    }
  };

  const confirmRebuild = () => {
    Alert.alert(
      'Rebuild local library index?',
      'A foreground scan will re-read every local track. Folders, playlists, favorites, history, remote sources, and settings are preserved.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Rebuild',
          onPress: () => void run(
            'rebuild',
            () => useLibraryStore.getState().rebuildLocalIndex(),
            'Local library index rebuilt.',
          ),
        },
      ]
    );
  };

  const confirmOnboarding = () => {
    Alert.alert(
      'Replay onboarding?',
      'The first-run setup opens immediately. Your library and settings are kept.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Replay',
          onPress: () => void run('onboarding', () => useOnboardingStore.getState().reset(), 'Opening onboarding…'),
        },
      ]
    );
  };

  return (
    <SettingsSectionScreen title="Troubleshooting">
      <ScanProgress />

      <SettingsSectionLabel>LIBRARY</SettingsSectionLabel>
      <MaintenanceRow
        icon="scan-outline"
        title="Scan for Changes"
        description="Run the normal foreground rescan for configured folders."
        disabled={disabled}
        running={runningAction === 'scan'}
        onPress={() => void run('scan', () => useLibraryStore.getState().rescan(), 'Library scan complete.')}
      />
      <MaintenanceRow
        icon="construct-outline"
        title="Rebuild Local Library Index"
        description="Re-read local track metadata without touching user data or remote sources."
        disabled={disabled}
        running={runningAction === 'rebuild'}
        onPress={confirmRebuild}
      />

      <SettingsSectionLabel spaced>CACHES</SettingsSectionLabel>
      <MaintenanceRow
        icon="musical-notes-outline"
        title="Clear Lyrics Cache"
        description={`${countLabel(counts?.lyrics ?? null, 'entry')} Preferences are kept.`}
        disabled={disabled}
        running={runningAction === 'lyrics'}
        onPress={() => void run('lyrics', async () => {
          await clearAllLyricsCache();
          useLyricsStore.getState().invalidateAll();
        }, 'Lyrics cache cleared.')}
      />
      <MaintenanceRow
        icon="pulse-outline"
        title="Clear Waveform Cache"
        description={`${countLabel(counts?.waveforms ?? null, 'waveform')} Tracks recompute on their next load.`}
        disabled={disabled}
        running={runningAction === 'waveform'}
        onPress={() => void run('waveform', clearAllWaveformCache, 'Waveform cache cleared.')}
      />

      <SettingsSectionLabel spaced>SETUP</SettingsSectionLabel>
      <MaintenanceRow
        icon="refresh-outline"
        title="Replay Onboarding"
        description="Open the first-run setup again without resetting library data."
        disabled={disabled}
        running={runningAction === 'onboarding'}
        onPress={confirmOnboarding}
      />

      {feedback ? (
        <View style={[styles.feedback, feedback.kind === 'error' && styles.errorFeedback]}>
          <Ionicons
            name={feedback.kind === 'success' ? 'checkmark-circle-outline' : 'alert-circle-outline'}
            size={18}
            color={feedback.kind === 'success' ? colors.accent : colors.warning}
          />
          <Text variant="caption" color={feedback.kind === 'success' ? colors.textSecondary : colors.warning} style={styles.feedbackText}>
            {feedback.text}
          </Text>
        </View>
      ) : null}
    </SettingsSectionScreen>
  );
}

function MaintenanceRow({
  icon,
  title,
  description,
  disabled,
  running,
  onPress,
}: {
  icon: SettingsIconName;
  title: string;
  description: string;
  disabled: boolean;
  running: boolean;
  onPress: () => void;
}) {
  const styles = useStyles();
  const colors = useColors();
  const ripple = useRipple();
  return (
    <Pressable
      disabled={disabled}
      android_ripple={ripple.bounded}
      unstable_pressDelay={SCROLL_PRESS_DELAY}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ disabled, busy: running }}
      style={[styles.row, disabled && !running && styles.disabled]}
    >
      <View style={styles.icon}>
        <Ionicons name={icon} size={20} color={colors.accent} />
      </View>
      <View style={styles.meta}>
        <Text variant="body">{title}</Text>
        <Text variant="caption" color={colors.textSecondary} style={styles.description}>{description}</Text>
      </View>
      {running ? <ActivityIndicator size="small" color={colors.accent} /> : <Ionicons name="chevron-forward" size={18} color={colors.textTertiary} />}
    </Pressable>
  );
}

const useStyles = createThemedStyles((colors) => ({
  row: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.lg,
    borderRadius: radius.md, borderWidth: 1, borderColor: colors.glassBorder,
    backgroundColor: colors.glassBg,
  },
  icon: {
    width: 36, height: 36, borderRadius: radius.sm,
    alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bgTertiary,
  },
  meta: { flex: 1, minWidth: 0, gap: 2 },
  description: { lineHeight: 16 },
  disabled: { opacity: 0.45 },
  feedback: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    padding: spacing.md, borderRadius: radius.sm,
    borderWidth: 1, borderColor: colors.glassBorder,
  },
  errorFeedback: { borderColor: colors.warning },
  feedbackText: { flex: 1 },
}));

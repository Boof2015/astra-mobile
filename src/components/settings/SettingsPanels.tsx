import {
  Alert,
  Pressable,
  StyleSheet,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { EQSlider } from '@/components/eq/EQSlider';
import { ScanProgress } from '@/components/library/ScanProgress';
import { SegmentedControl } from '@/components/SegmentedControl';
import { AccentSwatchRow } from '@/components/settings/AccentSwatchRow';
import { ScopeStyleCards } from '@/components/settings/ScopeStyleCards';
import {
  SettingsCard,
  SettingsSectionLabel,
  SettingsToggleRow,
} from '@/components/settings/SettingsSectionScaffold';
import { radius, spacing } from '@/theme';
import { createThemedStyles, useColors } from '@/theme/themed';
import { SCROLL_PRESS_DELAY, useRipple } from '@/theme/ripple';
import type { ReplayGainMode } from '@/audio/normalization';
import type { ArtistGroupingMode } from '@/library/artistGrouping';
import type { BaseThemeId, PreferredDark } from '@/theme/resolve';
import { useAudioSettingsStore } from '@/stores/audioSettingsStore';
import { useLibraryStore, type FolderWithCount } from '@/stores/libraryStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { useThemeStore } from '@/stores/themeStore';
import type { LastFmStatus } from '@/types/lastFm';
import { Text } from '@/components/Text';
import { playHaptic } from '@/lib/haptics';

export function lastFmScrobbleSubtitle(status: LastFmStatus | null): string {
  const connected = status?.profiles.filter((p) => p.connected).length ?? 0;
  if (connected === 0) return 'Scrobble plays to Last.fm, ListenBrainz, and more.';
  const base = `${connected} destination${connected === 1 ? '' : 's'} connected`;
  return status?.enabled ? `${base}.` : `${base}. Paused.`;
}

export function formatFolderCount(count: number): string {
  return `${count} ${count === 1 ? 'folder' : 'folders'}`;
}

export function formatTrackCount(count: number): string {
  return `${count} ${count === 1 ? 'track' : 'tracks'}`;
}

const THEME_OPTIONS: { id: BaseThemeId; title: string; description: string }[] = [
  { id: 'system', title: 'System', description: 'Follow the Android dark/light setting.' },
  { id: 'midnight', title: 'Midnight', description: 'Deep navy. The classic Astra look.' },
  { id: 'dark', title: 'Dark', description: 'Neutral dark gray, no navy cast.' },
  { id: 'amoled', title: 'AMOLED', description: 'True black. Easy on OLED screens and batteries.' },
  { id: 'light', title: 'Light', description: 'Cool near-white with navy ink.' },
  { id: 'materialYou', title: 'Material You', description: 'Colors from your wallpaper.' },
];

const DARK_STYLE_SEGMENTS = [
  { key: 'midnight', label: 'Midnight' },
  { key: 'dark', label: 'Dark' },
  { key: 'amoled', label: 'AMOLED' },
];

const ARTIST_GROUPING_OPTIONS: { mode: ArtistGroupingMode; title: string; description: string }[] = [
  {
    mode: 'astra',
    title: 'Astra grouping',
    description: 'Parse collaborators ("feat.", "&", "x"). Featured artists get their own entry.',
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

export function themeOptionTitle(id: BaseThemeId): string {
  return THEME_OPTIONS.find((option) => option.id === id)?.title ?? 'System';
}

export function AppearanceSettingsPanel() {
  const styles = useStyles();
  const ripple = useRipple();
  const colors = useColors();
  const baseTheme = useThemeStore((s) => s.baseTheme);
  const preferredDark = useThemeStore((s) => s.preferredDark);
  const accentId = useThemeStore((s) => s.accentId);
  const materialYouAvailable = useThemeStore((s) => s.materialYouAvailable);
  const resolvedId = useThemeStore((s) => s.theme.id);
  const setBaseTheme = useThemeStore((s) => s.setBaseTheme);
  const setPreferredDark = useThemeStore((s) => s.setPreferredDark);
  const setAccent = useThemeStore((s) => s.setAccent);

  const options = THEME_OPTIONS.filter(
    (option) => option.id !== 'materialYou' || materialYouAvailable
  );
  const accentApplies = !resolvedId.startsWith('materialYou');
  const nowPlayingScopeStyle = useSettingsStore((s) => s.nowPlayingScopeStyle);
  const setNowPlayingScopeStyle = useSettingsStore((s) => s.setNowPlayingScopeStyle);

  return (
    <>
      <View style={styles.options}>
        {options.map((option) => {
          const selected = option.id === baseTheme;
          return (
            <Pressable android_ripple={ripple.bounded} unstable_pressDelay={SCROLL_PRESS_DELAY}
              key={option.id}
              style={[styles.option, selected && styles.optionSelected]}
              onPress={() => {
                if (selected) return;
                playHaptic('selection');
                void setBaseTheme(option.id);
              }}
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

      {baseTheme === 'system' ? (
        <View style={styles.appearanceBlock}>
          <Text variant="caption" color={colors.textSecondary} style={styles.settingNote}>
            Dark style used when the system is dark.
          </Text>
          <SegmentedControl
            segments={DARK_STYLE_SEGMENTS}
            value={preferredDark}
            onChange={(key) => void setPreferredDark(key as PreferredDark)}
          />
        </View>
      ) : null}

      {accentApplies ? (
        <View style={styles.appearanceBlock}>
          <AccentSwatchRow value={accentId} onChange={(id) => void setAccent(id)} />
        </View>
      ) : null}

      <SettingsSectionLabel spaced>NOW PLAYING SCOPES</SettingsSectionLabel>
      <ScopeStyleCards
        value={nowPlayingScopeStyle}
        onChange={(style) => void setNowPlayingScopeStyle(style)}
      />
    </>
  );
}

function LibraryFolderSettingsRow({
  folder,
  disabled,
  onRemove,
}: {
  folder: FolderWithCount;
  disabled: boolean;
  onRemove: (folder: FolderWithCount) => void;
}) {
  const styles = useStyles();
  const ripple = useRipple();
  const colors = useColors();
  return (
    <View style={styles.folderSettingsRow}>
      <Ionicons
        name={folder.available ? 'folder-outline' : 'alert-circle-outline'}
        size={20}
        color={folder.available ? colors.textSecondary : colors.warning}
      />
      <View style={styles.folderSettingsMeta}>
        <Text variant="body" numberOfLines={1}>
          {folder.display_name}
        </Text>
        <Text
          variant="caption"
          color={folder.available ? colors.textSecondary : colors.warning}
          numberOfLines={1}
        >
          {folder.available
            ? formatTrackCount(folder.track_count)
            : 'Access lost. Remove and add again.'}
        </Text>
      </View>
      <Pressable android_ripple={ripple.bounded} unstable_pressDelay={SCROLL_PRESS_DELAY}
        hitSlop={8}
        disabled={disabled}
        onPress={() => onRemove(folder)}
        accessibilityRole="button"
        accessibilityLabel={`Remove ${folder.display_name}`}
        style={disabled && styles.actionDisabled}
      >
        <Ionicons name="trash-outline" size={18} color={colors.textTertiary} />
      </Pressable>
    </View>
  );
}

function LibraryFoldersSettings() {
  const styles = useStyles();
  const ripple = useRipple();
  const colors = useColors();
  const folders = useLibraryStore((s) => s.folders);
  const isScanning = useLibraryStore((s) => s.isScanning);
  const scanError = useLibraryStore((s) => s.scanError);
  const addFolder = useLibraryStore((s) => s.addFolder);
  const removeFolder = useLibraryStore((s) => s.removeFolder);
  const rescan = useLibraryStore((s) => s.rescan);

  const unavailableCount = folders.filter((folder) => !folder.available).length;
  const totalTracks = folders.reduce((sum, folder) => sum + folder.track_count, 0);

  const confirmRemove = (folder: FolderWithCount) => {
    Alert.alert(
      'Remove folder?',
      `"${folder.display_name}" and its ${formatTrackCount(folder.track_count)} will be removed from the library. Files on disk are not touched.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Remove', style: 'destructive', onPress: () => void removeFolder(folder.id) },
      ]
    );
  };

  return (
    <SettingsCard>
      <View style={styles.folderSettingsHeader}>
        <View style={styles.folderSettingsTitleBlock}>
          <Text variant="body">Local music folders</Text>
          <Text variant="caption" color={colors.textSecondary} style={styles.optionDescription}>
            {folders.length === 0
              ? 'Choose folders to scan into Astra.'
              : `${formatFolderCount(folders.length)} / ${formatTrackCount(totalTracks)}`}
          </Text>
        </View>
        <Pressable android_ripple={ripple.bounded} unstable_pressDelay={SCROLL_PRESS_DELAY}
          style={[styles.folderPrimaryAction, isScanning && styles.actionDisabled]}
          disabled={isScanning}
          onPress={() => void addFolder()}
          accessibilityRole="button"
        >
          <Ionicons name="add" size={17} color={colors.bgPrimary} />
          <Text variant="label" style={styles.folderPrimaryActionText}>
            Add
          </Text>
        </Pressable>
      </View>

      {folders.length > 0 ? (
        <View style={styles.folderSettingsActions}>
          <Pressable android_ripple={ripple.bounded} unstable_pressDelay={SCROLL_PRESS_DELAY}
            style={[styles.folderSecondaryAction, isScanning && styles.actionDisabled]}
            disabled={isScanning}
            onPress={() => void rescan()}
            accessibilityRole="button"
          >
            <Ionicons name="refresh" size={16} color={colors.textSecondary} />
            <Text variant="label" color={colors.textSecondary}>
              Rescan all
            </Text>
          </Pressable>
        </View>
      ) : null}

      <ScanProgress />

      {scanError ? (
        <Text variant="caption" color={colors.warning} style={styles.folderSettingsNotice} numberOfLines={2}>
          Scan problem: {scanError}
        </Text>
      ) : null}

      {unavailableCount > 0 ? (
        <Text variant="caption" color={colors.warning} style={styles.folderSettingsNotice} numberOfLines={2}>
          {formatFolderCount(unavailableCount)} need access again.
        </Text>
      ) : null}

      {folders.length > 0 ? (
        <View style={styles.folderSettingsList}>
          {folders.map((folder) => (
            <LibraryFolderSettingsRow
              key={folder.id}
              folder={folder}
              disabled={isScanning}
              onRemove={confirmRemove}
            />
          ))}
        </View>
      ) : null}
    </SettingsCard>
  );
}

export function LibrarySettingsPanel() {
  const styles = useStyles();
  const ripple = useRipple();
  const colors = useColors();
  const groupingMode = useSettingsStore((s) => s.artistGroupingMode);
  const setArtistGroupingMode = useSettingsStore((s) => s.setArtistGroupingMode);
  const includeSingles = useSettingsStore((s) => s.includeSingles);
  const setIncludeSingles = useSettingsStore((s) => s.setIncludeSingles);

  return (
    <>
      <SettingsSectionLabel>LOCAL FOLDERS</SettingsSectionLabel>
      <LibraryFoldersSettings />

      <SettingsSectionLabel spaced>LIBRARY VIEW</SettingsSectionLabel>
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
            <Pressable android_ripple={ripple.bounded} unstable_pressDelay={SCROLL_PRESS_DELAY}
              key={option.mode}
              style={[styles.option, selected && styles.optionSelected]}
              onPress={() => {
                if (selected) return;
                playHaptic('selection');
                void setArtistGroupingMode(option.mode);
              }}
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

      <SettingsCard style={styles.cardSpacing}>
        <SettingsToggleRow
          title="Show singles in Albums"
          description="Include 1-track albums in the Albums view. Off matches desktop."
          value={includeSingles}
          onValueChange={(v) => void setIncludeSingles(v)}
        />
      </SettingsCard>
    </>
  );
}

export function AudioSettingsPanel() {
  const styles = useStyles();
  const ripple = useRipple();
  const colors = useColors();
  const normalizationEnabled = useAudioSettingsStore((s) => s.normalizationEnabled);
  const normalizationTargetLufs = useAudioSettingsStore((s) => s.normalizationTargetLufs);
  const replayGainEnabled = useAudioSettingsStore((s) => s.replayGainEnabled);
  const replayGainMode = useAudioSettingsStore((s) => s.replayGainMode);
  const setNormalizationEnabled = useAudioSettingsStore((s) => s.setNormalizationEnabled);
  const setNormalizationTargetLufs = useAudioSettingsStore((s) => s.setNormalizationTargetLufs);
  const setReplayGainEnabled = useAudioSettingsStore((s) => s.setReplayGainEnabled);
  const setReplayGainMode = useAudioSettingsStore((s) => s.setReplayGainMode);

  return (
    <>
      <SettingsSectionLabel>LOUDNESS</SettingsSectionLabel>
      <SettingsCard>
        <SettingsToggleRow
          title="Loudness normalization"
          description="Level every track to a target loudness. Keeps playback volume and scopes consistent."
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
      </SettingsCard>

      <SettingsSectionLabel spaced>REPLAYGAIN</SettingsSectionLabel>
      <SettingsCard>
        <SettingsToggleRow
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
                <Pressable android_ripple={ripple.bounded} unstable_pressDelay={SCROLL_PRESS_DELAY}
                  key={m.mode}
                  style={[styles.modePill, selected && styles.modePillSelected]}
                  onPress={() => {
                    if (selected) return;
                    playHaptic('selection');
                    void setReplayGainMode(m.mode);
                  }}
                >
                  <Text variant="label" color={selected ? colors.accentTextStrong : colors.textSecondary}>
                    {m.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        ) : null}
      </SettingsCard>
    </>
  );
}

const useStyles = createThemedStyles((colors) => ({
  appearanceBlock: {
    marginTop: spacing.md,
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
    minWidth: 0,
    gap: 2,
  },
  optionDescription: {
    lineHeight: 16,
  },
  folderSettingsHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  folderSettingsTitleBlock: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  folderPrimaryAction: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    borderRadius: radius.pill,
    backgroundColor: colors.accent,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  folderPrimaryActionText: {
    color: colors.bgPrimary,
    fontWeight: '600',
  },
  folderSettingsActions: {
    flexDirection: 'row',
    marginTop: spacing.md,
  },
  folderSecondaryAction: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glassBorder,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  folderSettingsNotice: {
    marginTop: spacing.sm,
  },
  folderSettingsList: {
    marginTop: spacing.md,
    borderTopColor: colors.glassBorder,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  folderSettingsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: 52,
    borderBottomColor: colors.glassBorder,
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingVertical: spacing.sm,
  },
  folderSettingsMeta: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  actionDisabled: {
    opacity: 0.4,
  },
  cardSpacing: {
    marginTop: spacing.sm,
  },
  indent: {
    marginTop: spacing.sm,
  },
  modeRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
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
}));

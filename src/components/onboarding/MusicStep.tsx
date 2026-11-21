import { StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { ActionButton } from '@/components/ActionButton';
import { AppPressable } from '@/components/AppPressable';
import { Text } from '@/components/Text';
import { onboardingServerStatus } from '@/components/sources/sourceStatus';
import { playHaptic } from '@/lib/haptics';
import { useLibraryStore, type FolderWithCount } from '@/stores/libraryStore';
import { useRemoteSourcesStore } from '@/stores/remoteSourcesStore';
import { fonts, radius, spacing } from '@/theme';
import { selectionSurface } from '@/theme/actionButtons';
import { createThemedStyles, useColors } from '@/theme/themed';
import type { RemoteSourceRow } from '@/types/remote';
import { OnboardingFrame, useOnboardingNav } from './OnboardingFrame';

const fmt = (value: number) => value.toLocaleString('en-US');

/**
 * Where the music comes from: folders on this phone and a Subsonic/Jellyfin
 * server are equal options, and whatever has been added sits in one list with
 * live status. A scan or a sync keeps running after "Continue"; the stores own
 * both, not this page.
 */
export function MusicStep() {
  const styles = useStyles();
  const colors = useColors();
  const nav = useOnboardingNav();
  const folders = useLibraryStore((s) => s.folders);
  const isScanning = useLibraryStore((s) => s.isScanning);
  const scanningFolder = useLibraryStore((s) => (s.isScanning ? s.scanProgress.folderName ?? null : null));
  const servers = useRemoteSourcesStore((s) => s.sources);
  const anything = folders.length > 0 || servers.length > 0 || isScanning;
  // A rescan of a folder already listed shows once, as the scanning row.
  const listedFolders = scanningFolder ? folders.filter((folder) => folder.display_name !== scanningFolder) : folders;

  return (
    <OnboardingFrame
      eyebrow="Your music"
      title="Where’s your music?"
      subtitle="Add folders on this phone, connect a server, or both. Astra reads your files and never changes them."
      footer={
        anything ? (
          <ActionButton style={styles.grow} variant="primary" label="Continue" onPress={nav.next} />
        ) : (
          <ActionButton style={styles.grow} variant="secondary" label="Skip for now" onPress={nav.next} />
        )
      }
    >
      <View style={styles.cards}>
        <SourceCard
          icon="phone-portrait-outline"
          title="On this phone"
          description={
            isScanning
              ? 'Scanning now. Add another folder when it finishes.'
              : folders.length > 0
                ? 'Add another folder'
                : 'Folders on internal storage or an SD card'
          }
          disabled={isScanning}
          onPress={() => void useLibraryStore.getState().addFolder()}
        />
        <SourceCard
          icon="server-outline"
          title="Music server"
          description={servers.length > 0 ? 'Connect another server' : 'Subsonic, Navidrome or Jellyfin'}
          onPress={() => nav.goTo('server')}
        />
      </View>
      {anything ? (
        <View>
          <Text variant="mono" color={colors.textTertiary} style={styles.listLabel}>
            ADDED
          </Text>
          <ScanningRow />
          {listedFolders.map((folder) => (
            <FolderRow key={folder.id} folder={folder} />
          ))}
          {servers.map((server) => (
            <ServerRow key={server.id} server={server} />
          ))}
        </View>
      ) : (
        <Text variant="caption" color={colors.textTertiary} style={styles.hint}>
          You can add more later in Settings › Library.
        </Text>
      )}
    </OnboardingFrame>
  );
}

function SourceCard({
  icon,
  title,
  description,
  disabled = false,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  description: string;
  disabled?: boolean;
  onPress: () => void;
}) {
  const styles = useStyles();
  const colors = useColors();
  return (
    <AppPressable
      style={[styles.card, disabled && styles.cardDisabled]}
      disabled={disabled}
      onPress={() => {
        playHaptic('selection');
        onPress();
      }}
      accessibilityRole="button"
      accessibilityLabel={`${title}. ${description}`}
      accessibilityState={{ disabled }}
    >
      <View style={[styles.glyph, { backgroundColor: selectionSurface(colors) }]}>
        <Ionicons name={icon} size={20} color={colors.accentText} />
      </View>
      <Text variant="body" style={styles.cardTitle}>
        {title}
      </Text>
      <Text variant="caption" color={colors.textSecondary}>
        {description}
      </Text>
    </AppPressable>
  );
}

/**
 * The folder being scanned. The folders list only refreshes when a scan ends,
 * so a first scan has no row of its own yet; this stands in for it, carrying
 * the Cancel that Google requires for as long as the scan service runs.
 */
function ScanningRow() {
  const styles = useStyles();
  const colors = useColors();
  const isScanning = useLibraryStore((s) => s.isScanning);
  const isCancelling = useLibraryStore((s) => s.isCancelling);
  const progress = useLibraryStore((s) => s.scanProgress);
  if (!isScanning) return null;
  const counted = (progress.phase === 'extracting' || progress.phase === 'analyzing') && progress.total > 0;
  const status = isCancelling
    ? 'Canceling…'
    : counted
      ? `${progress.phase === 'analyzing' ? 'Analyzing' : 'Scanning'} · ${fmt(progress.processed)} / ${fmt(progress.total)}`
      : progress.total > 0
        ? `Found ${fmt(progress.total)} files`
        : 'Looking for music…';
  return (
    <View style={styles.row}>
      <View style={styles.tile}>
        <Ionicons name="folder-outline" size={20} color={colors.textSecondary} />
      </View>
      <View style={styles.rowText}>
        <Text variant="body" numberOfLines={1} style={styles.rowName}>
          {progress.folderName || 'Your music'}
        </Text>
        <Text variant="mono" numberOfLines={1} color={colors.textSecondary} style={styles.rowStatus}>
          {status}
        </Text>
        <View style={styles.bar}>
          <View
            style={[
              styles.barFill,
              counted ? { width: `${Math.min(1, progress.processed / progress.total) * 100}%` } : styles.barIndeterminate,
            ]}
          />
        </View>
      </View>
      <ActionButton
        variant="secondary"
        label={isCancelling ? 'Canceling…' : 'Cancel'}
        disabled={isCancelling}
        onPress={() => useLibraryStore.getState().cancelScan()}
        style={styles.rowButton}
        accessibilityLabel="Cancel library scan"
        accessibilityState={{ disabled: isCancelling, busy: isCancelling }}
        hitSlop={6}
      />
    </View>
  );
}

function FolderRow({ folder }: { folder: FolderWithCount }) {
  const styles = useStyles();
  const colors = useColors();
  const isScanning = useLibraryStore((s) => s.isScanning);
  // While any scan runs, the scanning row speaks for the library; a rescan of
  // this folder would otherwise show twice.
  const scanned = folder.last_scanned_at != null;
  const status = !folder.available
    ? { text: 'Storage unavailable · library kept', tone: 'normal' as const }
    : folder.scan_error
      ? { text: folder.scan_error, tone: 'error' as const }
      : scanned
        ? { text: `${fmt(folder.track_count)} ${folder.track_count === 1 ? 'track' : 'tracks'} · Ready`, tone: 'normal' as const }
        : { text: 'Not scanned', tone: 'normal' as const };
  const canRescan = !isScanning && folder.available && (!scanned || !!folder.scan_error);
  return (
    <View style={styles.row}>
      <View style={styles.tile}>
        <Ionicons name="folder-outline" size={20} color={colors.textSecondary} />
      </View>
      <View style={styles.rowText}>
        <Text variant="body" numberOfLines={1} style={styles.rowName}>
          {folder.display_name}
        </Text>
        <Text
          variant="mono"
          numberOfLines={1}
          color={status.tone === 'error' ? colors.warning : colors.textSecondary}
          style={styles.rowStatus}
        >
          {status.text}
        </Text>
      </View>
      {canRescan ? (
        <ActionButton
          variant="secondary"
          label="Scan again"
          onPress={() => void useLibraryStore.getState().rescan()}
          style={styles.rowButton}
          hitSlop={6}
        />
      ) : scanned && !folder.scan_error ? (
        <Ionicons name="checkmark" size={20} color={colors.accent} style={styles.rowEnd} />
      ) : null}
    </View>
  );
}

function ServerRow({ server }: { server: RemoteSourceRow }) {
  const styles = useStyles();
  const colors = useColors();
  const progress = useRemoteSourcesStore((s) => s.progressById[server.id] ?? null);
  const status = onboardingServerStatus(server, progress);
  return (
    <View style={styles.row}>
      <View style={styles.tile}>
        <Ionicons name="server-outline" size={20} color={colors.textSecondary} />
      </View>
      <View style={styles.rowText}>
        <Text variant="body" numberOfLines={1} style={styles.rowName}>
          {server.name}
        </Text>
        <Text
          variant="mono"
          numberOfLines={1}
          color={status.tone === 'error' ? colors.warning : colors.textSecondary}
          style={styles.rowStatus}
        >
          {status.text}
        </Text>
        {/* A sync has no overall total, so it gets the faint full bar, not a fake fraction. */}
        {status.state === 'syncing' ? (
          <View style={styles.bar}>
            <View style={[styles.barFill, styles.barIndeterminate]} />
          </View>
        ) : null}
      </View>
      {status.state === 'connected' ? (
        <Ionicons name="checkmark" size={20} color={colors.accent} style={styles.rowEnd} />
      ) : status.state === 'error' ? (
        <Ionicons name="alert-circle-outline" size={20} color={colors.warning} style={styles.rowEnd} />
      ) : null}
    </View>
  );
}

const useStyles = createThemedStyles((colors) => ({
  grow: {
    flex: 1,
    minHeight: 52,
  },
  cards: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  card: {
    flex: 1,
    minHeight: 128,
    gap: 6,
    padding: 14,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glassBorder,
    backgroundColor: colors.glassBg,
  },
  cardDisabled: {
    opacity: 0.55,
  },
  glyph: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 6,
  },
  cardTitle: {
    fontFamily: fonts.sans.semibold,
    fontSize: 15,
  },
  listLabel: {
    fontSize: 11,
    letterSpacing: 0.9,
    marginTop: spacing.xl,
    marginBottom: spacing.sm,
  },
  hint: {
    marginTop: 18,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.glassBorder,
  },
  tile: {
    width: 40,
    height: 40,
    borderRadius: radius.md,
    backgroundColor: colors.bgTertiary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowText: {
    flex: 1,
    minWidth: 0,
  },
  rowName: {
    fontFamily: fonts.sans.medium,
  },
  rowStatus: {
    fontSize: 11,
    lineHeight: 15,
  },
  bar: {
    height: 3,
    borderRadius: 2,
    marginTop: 6,
    backgroundColor: colors.glassBorder,
    overflow: 'hidden',
  },
  barFill: {
    height: 3,
    backgroundColor: colors.accent,
  },
  barIndeterminate: {
    width: '100%',
    opacity: 0.35,
  },
  rowButton: {
    minHeight: 34,
    paddingHorizontal: spacing.md,
  },
  rowEnd: {
    marginRight: 4,
  },
}));

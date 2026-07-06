// Desktop Sync — favorites/playlists library sync with the paired desktop.
// Separate surface from the Desktop Remote controller: it shares the pairing
// (one paired desktop serves both features) but nothing else. Conflict
// resolution (Steam-Cloud style) lives inline here; the desktop mirrors the
// same conflicts in its own settings and either side may resolve them.

import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { Screen } from '@/components/Screen';
import { Text } from '@/components/Text';
import { SyncConflictDetails } from '@/components/sync/SyncConflictDetails';
import { colors, radius, spacing } from '@/theme';
import { formatRelativeTime } from '@/lib/format';
import { getDesktopRemoteConnection } from '@/services/desktopRemoteCredentials';
import { useDesktopSyncStore } from '@/stores/desktopSyncStore';
import {
  buildSyncConflictResolutionPreview,
  syncPlaylistToSnapshot,
} from '@/shared/sync/conflictPreview';
import type { DesktopRemoteConnection } from '@/types/desktopRemote';
import type {
  DesktopSyncConflictResolution,
  DesktopSyncPlaylistConflict,
} from '@/types/desktopSync';

const RESOLUTION_LABELS: Record<DesktopSyncConflictResolution, string> = {
  desktop: 'Use desktop',
  phone: 'Use phone',
  both: 'Keep both',
  merge: 'Combine songs',
};

function resolutionOptions(conflict: DesktopSyncPlaylistConflict): DesktopSyncConflictResolution[] {
  return conflict.playlistKind === 'dynamic'
    ? ['desktop', 'phone', 'both']
    : ['desktop', 'phone', 'both', 'merge'];
}

function conflictDescription(conflict: DesktopSyncPlaylistConflict): string {
  if (conflict.kind === 'first-pairing') {
    return conflict.playlistKind === 'dynamic'
      ? 'Exists on both devices with different rules.'
      : 'Exists on both devices with different songs.';
  }
  return 'Edited on both devices since the last sync.';
}

function ConflictCard({
  conflict,
  desktopName,
  busy,
  onResolve,
}: {
  conflict: DesktopSyncPlaylistConflict;
  desktopName: string;
  busy: boolean;
  onResolve: (resolution: DesktopSyncConflictResolution) => void;
}) {
  const [selectedResolution, setSelectedResolution] = useState<DesktopSyncConflictResolution | null>(null);
  const desktopSnapshot = syncPlaylistToSnapshot(conflict.remote);
  const phoneSnapshot = syncPlaylistToSnapshot(conflict.local);
  const options = resolutionOptions(conflict);
  const preview = selectedResolution
    ? buildSyncConflictResolutionPreview(selectedResolution, desktopSnapshot, phoneSnapshot)
    : null;
  return (
    <View style={styles.conflictCard}>
      <Text variant="body" numberOfLines={1}>
        {conflict.localName}
      </Text>
      <Text variant="caption" color={colors.textSecondary}>
        {conflictDescription(conflict)}
      </Text>
      <View style={styles.conflictActions}>
        {options.map((resolution) => (
          <Pressable
            key={resolution}
            style={[
              styles.conflictBtn,
              selectedResolution === resolution ? styles.conflictBtnSelected : null,
              busy && styles.disabled,
            ]}
            disabled={busy}
            onPress={() => setSelectedResolution(resolution)}
          >
            <Text variant="label">{RESOLUTION_LABELS[resolution]}</Text>
          </Pressable>
        ))}
      </View>
      <View style={styles.previewBox}>
        <Text variant="label">
          {preview ? preview.title : 'Choose an option to preview it'}
        </Text>
        <Text variant="caption" color={colors.textSecondary}>
          {preview ? preview.detail : 'Nothing changes until you confirm.'}
        </Text>
      </View>
      <SyncConflictDetails
        conflict={conflict}
        desktopName={desktopName}
        maxRows={5}
        previewResolution={selectedResolution}
      />
      <View style={styles.conflictConfirmRow}>
        <Pressable
          style={[styles.primaryButton, (!selectedResolution || busy) && styles.disabled]}
          disabled={!selectedResolution || busy}
          onPress={() => selectedResolution ? onResolve(selectedResolution) : undefined}
        >
          <Text variant="body" color={colors.accentTextStrong}>
            Confirm
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

export default function DesktopSyncScreen() {
  const router = useRouter();
  const status = useDesktopSyncStore((s) => s.status);
  const lastSyncAt = useDesktopSyncStore((s) => s.lastSyncAt);
  const lastSummary = useDesktopSyncStore((s) => s.lastSummary);
  const conflicts = useDesktopSyncStore((s) => s.conflicts);
  const errorMessage = useDesktopSyncStore((s) => s.errorMessage);
  const autoSyncEnabled = useDesktopSyncStore((s) => s.autoSyncEnabled);
  const syncNow = useDesktopSyncStore((s) => s.syncNow);
  const setAutoSyncEnabled = useDesktopSyncStore((s) => s.setAutoSyncEnabled);
  const resolveConflict = useDesktopSyncStore((s) => s.resolveConflict);

  const [connection, setConnection] = useState<DesktopRemoteConnection | null>(null);
  const [connectionLoaded, setConnectionLoaded] = useState(false);

  useEffect(() => {
    void useDesktopSyncStore.getState().hydrate();
    void getDesktopRemoteConnection().then((stored) => {
      setConnection(stored);
      setConnectionLoaded(true);
    });
  }, []);

  const desktopName = connection?.desktopName ?? 'Astra Desktop';
  const syncing = status === 'syncing';
  const summaryLine = lastSummary
    ? [
        lastSummary.favoritesAdded > 0 ? `${lastSummary.favoritesAdded} favorites added` : null,
        lastSummary.favoritesRemoved > 0 ? `${lastSummary.favoritesRemoved} removed` : null,
        lastSummary.playlistsCreated + lastSummary.playlistsReplaced > 0
          ? `${lastSummary.playlistsCreated + lastSummary.playlistsReplaced} playlists updated`
          : null,
        lastSummary.playlistsDeleted > 0 ? `${lastSummary.playlistsDeleted} playlists removed` : null,
        lastSummary.favoritesPending > 0 ? `${lastSummary.favoritesPending} pending a library match` : null,
      ]
        .filter((part): part is string => part !== null)
        .join(' · ')
    : '';

  return (
    <Screen>
      <View style={styles.topBar}>
        <Pressable style={styles.back} onPress={() => router.back()} hitSlop={8}>
          <Ionicons name="chevron-back" size={22} color={colors.textSecondary} />
          <Text variant="body" color={colors.textSecondary}>
            Settings
          </Text>
        </Pressable>
      </View>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
        <View style={styles.hero}>
          <Ionicons name="sync-outline" size={30} color={colors.accent} />
          <View style={styles.heroText}>
            <Text variant="title" style={styles.heading}>
              Desktop Sync
            </Text>
            <Text variant="body" color={colors.textSecondary}>
              Keep favorites and playlists in step with Astra Desktop over your LAN.
            </Text>
          </View>
        </View>

        {!connectionLoaded ? (
          <ActivityIndicator color={colors.accent} />
        ) : !connection ? (
          <View style={styles.card}>
            <Text variant="body">No desktop paired</Text>
            <Text variant="caption" color={colors.textSecondary} style={styles.cardCopy}>
              Sync uses the same pairing as the Desktop Remote. Pair this phone with Astra Desktop
              once and both features work.
            </Text>
            <Pressable
              style={styles.primaryButton}
              onPress={() => router.push('/desktop-remote' as never)}
            >
              <Ionicons name="link-outline" size={18} color={colors.accentTextStrong} />
              <Text variant="body" color={colors.accentTextStrong}>
                Pair with a desktop
              </Text>
            </Pressable>
          </View>
        ) : (
          <>
            <View style={styles.card}>
              <View style={styles.cardHeader}>
                <View style={styles.cardHeaderText}>
                  <Text variant="body">{desktopName}</Text>
                  <Text variant="caption" color={colors.textSecondary}>
                    {syncing
                      ? 'Syncing…'
                      : lastSyncAt !== null
                        ? `Synced ${formatRelativeTime(lastSyncAt)}`
                        : 'Not synced yet'}
                  </Text>
                </View>
                <Pressable
                  style={[styles.primaryButton, syncing && styles.disabled]}
                  disabled={syncing}
                  onPress={() => void syncNow()}
                  accessibilityLabel="Sync favorites and playlists now"
                >
                  {syncing ? (
                    <ActivityIndicator size="small" color={colors.accentTextStrong} />
                  ) : (
                    <Ionicons name="sync-outline" size={18} color={colors.accentTextStrong} />
                  )}
                  <Text variant="body" color={colors.accentTextStrong}>
                    Sync now
                  </Text>
                </Pressable>
              </View>
              {summaryLine ? (
                <Text variant="caption" color={colors.textTertiary}>
                  Last sync: {summaryLine}
                </Text>
              ) : null}
              {errorMessage ? (
                <Text variant="caption" color={colors.warning}>
                  {errorMessage}
                </Text>
              ) : null}
            </View>

            <View style={styles.card}>
              <View style={styles.toggleRow}>
                <View style={styles.toggleText}>
                  <Text variant="body">Sync automatically</Text>
                  <Text variant="caption" color={colors.textSecondary} style={styles.cardCopy}>
                    Sync when this desktop appears on the network or the app returns to the
                    foreground. Manual and desktop-requested syncs always work.
                  </Text>
                </View>
                <Switch
                  value={autoSyncEnabled}
                  onValueChange={(value) => void setAutoSyncEnabled(value)}
                  trackColor={{ false: colors.glassBorder, true: colors.accent }}
                  thumbColor={colors.textPrimary}
                />
              </View>
            </View>

            {conflicts.length > 0 ? (
              <View style={styles.card}>
                <Text variant="body">
                  {conflicts.length === 1 ? '1 conflict' : `${conflicts.length} conflicts`} to
                  resolve
                </Text>
                <Text variant="caption" color={colors.textSecondary} style={styles.cardCopy}>
                  These playlists differ between devices. Nothing changes until you choose —
                  everything else already synced. You can also resolve these from the desktop
                  settings.
                </Text>
                {conflicts.map((conflict) => (
                  <ConflictCard
                    key={conflict.syncUid}
                    conflict={conflict}
                    desktopName={desktopName}
                    busy={syncing}
                    onResolve={(resolution) => void resolveConflict(conflict, resolution)}
                  />
                ))}
              </View>
            ) : null}
          </>
        )}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  topBar: {
    marginTop: spacing.md,
    marginBottom: spacing.sm,
  },
  back: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  content: {
    paddingBottom: spacing.xxl,
    gap: spacing.md,
  },
  hero: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginTop: spacing.lg,
    marginBottom: spacing.sm,
  },
  heroText: {
    flex: 1,
  },
  heading: {
    marginBottom: spacing.xs,
  },
  card: {
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glassBorder,
    backgroundColor: colors.glassBg,
    padding: spacing.lg,
    gap: spacing.md,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  cardHeaderText: {
    flex: 1,
    minWidth: 0,
  },
  cardCopy: {
    lineHeight: 19,
  },
  primaryButton: {
    minHeight: 44,
    borderRadius: radius.sm,
    backgroundColor: colors.accent,
    paddingHorizontal: spacing.lg,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
  },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  toggleText: {
    flex: 1,
  },
  conflictCard: {
    borderRadius: radius.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glassBorder,
    backgroundColor: colors.bgSecondary,
    padding: spacing.md,
    gap: spacing.xs,
  },
  conflictActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  conflictBtn: {
    minHeight: 36,
    borderRadius: radius.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glassBorder,
    backgroundColor: colors.bgTertiary,
    paddingHorizontal: spacing.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  conflictBtnSelected: {
    borderColor: colors.accent,
    backgroundColor: colors.glassHighlight,
  },
  previewBox: {
    borderRadius: radius.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glassBorder,
    backgroundColor: colors.bgTertiary,
    padding: spacing.md,
    gap: spacing.xs,
    marginTop: spacing.xs,
  },
  conflictConfirmRow: {
    alignItems: 'flex-end',
    marginTop: spacing.xs,
  },
  disabled: {
    opacity: 0.5,
  },
});

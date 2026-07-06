// Root-mounted popup for desktop-sync conflicts: fires the moment a sync run
// detects NEW conflicts (auto or manual) instead of waiting for the user to
// wander into Settings. The once-per-session bookkeeping lives in
// desktopSyncStore (conflictPromptVisible) so this component is a pure
// derivation of store state — no set-state-in-effect (React Compiler rule).
// Suppressed while the user is already on the sync screen; if they leave it
// without resolving, the one pending reminder still shows.

import { useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router, usePathname } from 'expo-router';
import { Text } from '@/components/Text';
import { colors, radius, spacing } from '@/theme';
import { formatRelativeTime } from '@/lib/format';
import {
  buildSyncConflictResolutionPreview,
  buildSyncPlaylistEntryDiff,
  syncPlaylistToSnapshot,
} from '@/shared/sync/conflictPreview';
import { useDesktopSyncStore } from '@/stores/desktopSyncStore';
import type {
  DesktopSyncConflictResolution,
  DesktopSyncPlaylistConflict,
  SyncPlaylistSnapshot,
} from '@/types/desktopSync';

const RESOLUTION_LABELS: Record<DesktopSyncConflictResolution, string> = {
  desktop: 'Use desktop version',
  phone: 'Use phone version',
  both: 'Keep both playlists',
  merge: 'Combine songs',
};

function resolutionOptions(conflict: DesktopSyncPlaylistConflict): DesktopSyncConflictResolution[] {
  return conflict.playlistKind === 'dynamic'
    ? ['desktop', 'phone', 'both']
    : ['desktop', 'phone', 'both', 'merge'];
}

function sideSubtitle(snapshot: SyncPlaylistSnapshot): string {
  const count = snapshot.kind === 'dynamic'
    ? 'Dynamic playlist'
    : `${snapshot.trackCount} song${snapshot.trackCount === 1 ? '' : 's'}`;
  return `${count} · edited ${formatRelativeTime(snapshot.updatedAt)}`;
}

function diffLine(desktop: SyncPlaylistSnapshot, phone: SyncPlaylistSnapshot): string {
  if (desktop.kind !== 'normal' || phone.kind !== 'normal') {
    return desktop.dynamicRules === phone.dynamicRules
      ? 'The playlist details do not match.'
      : 'The playlist rules do not match.';
  }

  const diff = buildSyncPlaylistEntryDiff(desktop.entries, phone.entries);
  const parts = [
    diff.desktopOnlyCount > 0 ? `${diff.desktopOnlyCount} only on desktop` : null,
    diff.phoneOnlyCount > 0 ? `${diff.phoneOnlyCount} only on phone` : null,
    diff.movedCount > 0 ? `${diff.movedCount} in a different order` : null,
  ].filter((part): part is string => part !== null);
  return parts.length > 0 ? parts.join(' · ') : 'The playlists have the same songs.';
}

export function SyncConflictPrompt() {
  const conflicts = useDesktopSyncStore((s) => s.conflicts);
  const status = useDesktopSyncStore((s) => s.status);
  const promptVisible = useDesktopSyncStore((s) => s.conflictPromptVisible);
  const dismissConflictPrompt = useDesktopSyncStore((s) => s.dismissConflictPrompt);
  const resolveConflict = useDesktopSyncStore((s) => s.resolveConflict);
  const pathname = usePathname();
  const [choice, setChoice] = useState<{
    syncUid: string;
    resolution: DesktopSyncConflictResolution;
  } | null>(null);

  const visible = promptVisible && conflicts.length > 0 && pathname !== '/desktop-sync';
  if (!visible) return null;

  const count = conflicts.length;
  const firstConflict = conflicts[0];
  const busy = status === 'syncing';
  const desktopSnapshot = syncPlaylistToSnapshot(firstConflict.remote);
  const phoneSnapshot = syncPlaylistToSnapshot(firstConflict.local);
  const options = resolutionOptions(firstConflict);
  const selectedResolution = choice?.syncUid === firstConflict.syncUid && options.includes(choice.resolution)
    ? choice.resolution
    : null;
  const preview = selectedResolution
    ? buildSyncConflictResolutionPreview(selectedResolution, desktopSnapshot, phoneSnapshot)
    : null;

  const review = () => {
    dismissConflictPrompt();
    router.push('/desktop-sync' as never);
  };

  const confirm = () => {
    if (!selectedResolution || busy) return;
    dismissConflictPrompt();
    void resolveConflict(firstConflict, selectedResolution);
  };

  return (
    <Modal visible transparent animationType="fade" onRequestClose={dismissConflictPrompt}>
      <View style={styles.backdrop}>
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={dismissConflictPrompt}
          accessibilityLabel="Dismiss"
        />
        <View style={styles.card}>
          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scrollContent}>
            <View style={styles.header}>
              <Ionicons name="git-compare-outline" size={22} color={colors.warning} />
              <View style={styles.titleBlock}>
                <Text variant="heading" style={styles.title}>
                  Sync conflict{count === 1 ? '' : 's'}
                </Text>
                {count > 1 ? (
                  <Text variant="caption" color={colors.textTertiary}>
                    1 of {count}
                  </Text>
                ) : null}
              </View>
            </View>
            <Text variant="body" color={colors.textSecondary} style={styles.body}>
              “{firstConflict.localName}” is different on desktop and this phone.
            </Text>
            <View style={styles.sideSummaryGrid}>
              <View style={styles.sideSummaryCard}>
                <Text variant="label" color={colors.textSecondary}>
                  Desktop
                </Text>
                <Text variant="caption" numberOfLines={1}>
                  {desktopSnapshot.name}
                </Text>
                <Text variant="caption" color={colors.textTertiary} numberOfLines={1}>
                  {sideSubtitle(desktopSnapshot)}
                </Text>
              </View>
              <View style={styles.sideSummaryCard}>
                <Text variant="label" color={colors.textSecondary}>
                  This phone
                </Text>
                <Text variant="caption" numberOfLines={1}>
                  {phoneSnapshot.name}
                </Text>
                <Text variant="caption" color={colors.textTertiary} numberOfLines={1}>
                  {sideSubtitle(phoneSnapshot)}
                </Text>
              </View>
            </View>
            <Text variant="caption" color={colors.textTertiary}>
              {diffLine(desktopSnapshot, phoneSnapshot)}
            </Text>
            <View style={styles.choiceList}>
              {options.map((resolution) => (
                <Pressable
                  key={resolution}
                  style={[
                    styles.choiceRow,
                    selectedResolution === resolution ? styles.choiceRowSelected : null,
                    busy && styles.disabled,
                  ]}
                  disabled={busy}
                  onPress={() => setChoice({ syncUid: firstConflict.syncUid, resolution })}
                >
                  <Text variant="label">{RESOLUTION_LABELS[resolution]}</Text>
                </Pressable>
              ))}
            </View>
            <View style={styles.previewBox}>
              <Text variant="label">
                {preview ? preview.title : 'Choose what should happen'}
              </Text>
              <Text variant="caption" color={colors.textSecondary}>
                {preview
                  ? preview.detail
                  : 'Nothing changes until you confirm.'}
              </Text>
            </View>
            {count > 1 ? (
              <Pressable onPress={review} style={styles.reviewLink}>
                <Text variant="caption" color={colors.accent}>
                  Review all {count} conflicts
                </Text>
              </Pressable>
            ) : null}
          </ScrollView>
          <View style={styles.actions}>
            <Pressable style={styles.secondaryButton} onPress={dismissConflictPrompt}>
              <Text variant="body" color={colors.textSecondary}>
                Not now
              </Text>
            </Pressable>
            <Pressable
              style={[styles.primaryButton, (!selectedResolution || busy) && styles.disabled]}
              disabled={!selectedResolution || busy}
              onPress={confirm}
            >
              <Text variant="body" color={colors.accentTextStrong}>
                Confirm
              </Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.55)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
  },
  card: {
    width: '100%',
    maxWidth: 400,
    maxHeight: '88%',
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glassBorder,
    backgroundColor: colors.bgSecondary,
    padding: spacing.lg,
    gap: spacing.sm,
  },
  scrollContent: {
    gap: spacing.md,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  titleBlock: {
    flex: 1,
  },
  title: {
    flex: 1,
  },
  body: {
    lineHeight: 21,
  },
  sideSummaryGrid: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  sideSummaryCard: {
    flex: 1,
    minWidth: 0,
    borderRadius: radius.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glassBorder,
    backgroundColor: colors.bgTertiary,
    padding: spacing.sm,
    gap: 2,
  },
  choiceList: {
    gap: spacing.sm,
  },
  choiceRow: {
    minHeight: 42,
    borderRadius: radius.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glassBorder,
    backgroundColor: colors.bgTertiary,
    paddingHorizontal: spacing.md,
    alignItems: 'flex-start',
    justifyContent: 'center',
  },
  choiceRowSelected: {
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
  },
  reviewLink: {
    alignSelf: 'flex-start',
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
  secondaryButton: {
    minHeight: 44,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryButton: {
    minHeight: 44,
    borderRadius: radius.sm,
    backgroundColor: colors.accent,
    paddingHorizontal: spacing.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  disabled: {
    opacity: 0.5,
  },
});

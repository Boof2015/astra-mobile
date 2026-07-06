import { StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '@/components/Text';
import { colors, radius, spacing } from '@/theme';
import { formatRelativeTime } from '@/lib/format';
import {
  buildSyncPlaylistEntryDiff,
  syncPlaylistToSnapshot,
  type SyncPlaylistEntryDiff,
} from '@/shared/sync/conflictPreview';
import type {
  DesktopSyncConflictResolution,
  DesktopSyncPlaylistConflict,
  SyncPlaylistSnapshot,
} from '@/types/desktopSync';

function playlistKindLabel(snapshot: SyncPlaylistSnapshot): string {
  return snapshot.kind === 'dynamic'
    ? 'Dynamic playlist'
    : `${snapshot.trackCount} song${snapshot.trackCount === 1 ? '' : 's'}`;
}

function sideSummary(snapshot: SyncPlaylistSnapshot): string {
  return `${playlistKindLabel(snapshot)} · edited ${formatRelativeTime(snapshot.updatedAt)}`;
}

function diffSummary(conflict: DesktopSyncPlaylistConflict): string {
  const desktop = syncPlaylistToSnapshot(conflict.remote);
  const phone = syncPlaylistToSnapshot(conflict.local);
  if (desktop.kind !== 'normal' || phone.kind !== 'normal') {
    return desktop.dynamicRules === phone.dynamicRules
      ? 'Names or dynamic playlist metadata differ.'
      : 'Dynamic playlist rules differ.';
  }

  const diff = buildSyncPlaylistEntryDiff(desktop.entries, phone.entries);
  const parts = [
    diff.desktopOnlyCount > 0 ? `${diff.desktopOnlyCount} only on desktop` : null,
    diff.phoneOnlyCount > 0 ? `${diff.phoneOnlyCount} only on phone` : null,
    diff.movedCount > 0 ? `${diff.movedCount} in a different order` : null,
  ].filter((part): part is string => part !== null);

  if (parts.length > 0) return parts.join(' · ');
  if (desktop.name.trim() !== phone.name.trim()) return 'Playlist names differ.';
  return 'Same songs; playlist metadata differs.';
}

function previewStatusLabel(
  row: SyncPlaylistEntryDiff,
  side: 'desktop' | 'phone',
  resolution: DesktopSyncConflictResolution | null
): string | null {
  if (!resolution) return null;
  if (resolution === 'both') return 'Stays separate';
  if (resolution === 'merge') return row.status === 'moved' ? 'Order chosen' : 'Added';

  const keptSide = resolution;
  if (side === keptSide) return row.status === 'moved' ? 'Order kept' : 'Kept';
  return row.status === 'moved' ? 'Order changes' : 'Removed';
}

function moveStatusLabel(row: SyncPlaylistEntryDiff, side: 'desktop' | 'phone'): string {
  if (row.status === 'moved') {
    const from = side === 'desktop' ? row.desktopIndex : row.phoneIndex;
    const to = side === 'desktop' ? row.phoneIndex : row.desktopIndex;
    return from !== null && to !== null ? `${from + 1} to ${to + 1}` : 'Different order';
  }
  return '';
}

function TrackDiffRow({
  row,
  side,
  previewResolution,
}: {
  row: SyncPlaylistEntryDiff;
  side: 'desktop' | 'phone';
  previewResolution: DesktopSyncConflictResolution | null;
}) {
  const subtitle = [row.artist, row.album].filter((part) => part.trim().length > 0).join(' · ');
  const previewLabel = previewStatusLabel(row, side, previewResolution);
  const moveLabel = row.status === 'moved' && !previewLabel ? moveStatusLabel(row, side) : null;
  return (
    <View style={[
      styles.trackRow,
      previewResolution === 'merge' && row.status !== 'moved' ? styles.trackRowAdded : null,
      previewResolution === 'both' ? styles.trackRowSeparate : null,
      previewResolution === 'desktop' && side === 'phone' ? styles.trackRowRemoved : null,
      previewResolution === 'phone' && side === 'desktop' ? styles.trackRowRemoved : null,
    ]}>
      <View style={styles.trackText}>
        <Text variant="caption" numberOfLines={1}>
          {row.title || 'Untitled track'}
        </Text>
        {subtitle ? (
          <Text variant="caption" color={colors.textTertiary} numberOfLines={1}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {previewLabel || moveLabel ? (
        <Text
          variant="caption"
          color={previewLabel ? colors.textSecondary : colors.textTertiary}
          numberOfLines={1}
          style={styles.trackBadge}
        >
          {previewLabel ?? moveLabel}
        </Text>
      ) : null}
    </View>
  );
}

function SideTrackList({
  side,
  sideOnlyRows,
  movedRows,
  previewResolution,
  maxRows,
}: {
  side: 'desktop' | 'phone';
  sideOnlyRows: SyncPlaylistEntryDiff[];
  movedRows: SyncPlaylistEntryDiff[];
  previewResolution: DesktopSyncConflictResolution | null;
  maxRows: number;
}) {
  const rows = [...sideOnlyRows, ...movedRows].slice(0, maxRows);
  const hiddenCount = Math.max(0, sideOnlyRows.length + movedRows.length - rows.length);
  const sideName = side === 'desktop' ? 'desktop' : 'phone';

  if (rows.length === 0) {
    return (
      <Text variant="caption" color={colors.textTertiary}>
        No songs only on {sideName}.
      </Text>
    );
  }

  return (
    <View style={styles.trackRows}>
      {sideOnlyRows.length > 0 ? (
        <Text variant="caption" color={colors.textTertiary} style={styles.sectionLabel}>
          Only on {sideName}
        </Text>
      ) : null}
      {rows.map((row, index) => {
        const startsMovedSection = row.status === 'moved' && rows[index - 1]?.status !== 'moved';
        return (
          <View key={row.key} style={styles.trackGroup}>
            {startsMovedSection ? (
              <Text variant="caption" color={colors.textTertiary} style={styles.sectionLabel}>
                Different order
              </Text>
            ) : null}
            <TrackDiffRow row={row} side={side} previewResolution={previewResolution} />
          </View>
        );
      })}
      {hiddenCount > 0 ? (
        <Text variant="caption" color={colors.textTertiary}>
          +{hiddenCount} more
        </Text>
      ) : null}
    </View>
  );
}

export function SyncConflictDetails({
  conflict,
  desktopName,
  maxRows = 4,
  previewResolution = null,
}: {
  conflict: DesktopSyncPlaylistConflict;
  desktopName: string;
  maxRows?: number;
  previewResolution?: DesktopSyncConflictResolution | null;
}) {
  const desktop = syncPlaylistToSnapshot(conflict.remote);
  const phone = syncPlaylistToSnapshot(conflict.local);
  const isNormal = desktop.kind === 'normal' && phone.kind === 'normal';
  const diff = isNormal ? buildSyncPlaylistEntryDiff(desktop.entries, phone.entries) : null;
  const desktopOnlyRows = diff?.rows.filter((row) => row.status === 'desktop-only') ?? [];
  const phoneOnlyRows = diff?.rows.filter((row) => row.status === 'phone-only') ?? [];
  const movedRows = diff?.rows.filter((row) => row.status === 'moved') ?? [];
  const desktopDimmed = previewResolution === 'phone';
  const phoneDimmed = previewResolution === 'desktop';
  const desktopActive = previewResolution === 'desktop' || previewResolution === 'both' || previewResolution === 'merge';
  const phoneActive = previewResolution === 'phone' || previewResolution === 'both' || previewResolution === 'merge';

  return (
    <View style={styles.container}>
      <View style={styles.compareGrid}>
        <View style={[
          styles.sideCard,
          desktopDimmed ? styles.sideCardDimmed : null,
          desktopActive ? styles.sideCardActive : null,
        ]}>
          <View style={styles.sideHead}>
            <Ionicons name="desktop-outline" size={15} color={colors.textSecondary} />
            <Text variant="caption" color={colors.textSecondary} numberOfLines={1} style={styles.sideTitle}>
              {desktopName}
            </Text>
          </View>
          <Text variant="caption" numberOfLines={1}>
            {desktop.name}
          </Text>
          <Text variant="caption" color={colors.textTertiary} numberOfLines={1}>
            {sideSummary(desktop)}
          </Text>
          {isNormal ? (
            <SideTrackList
              side="desktop"
              sideOnlyRows={desktopOnlyRows}
              movedRows={movedRows}
              previewResolution={previewResolution}
              maxRows={maxRows}
            />
          ) : (
            <Text variant="caption" color={colors.textTertiary} numberOfLines={3}>
              {desktop.dynamicRules ?? 'No rules'}
            </Text>
          )}
        </View>

        <View style={[
          styles.sideCard,
          phoneDimmed ? styles.sideCardDimmed : null,
          phoneActive ? styles.sideCardActive : null,
        ]}>
          <View style={styles.sideHead}>
            <Ionicons name="phone-portrait-outline" size={15} color={colors.textSecondary} />
            <Text variant="caption" color={colors.textSecondary} numberOfLines={1} style={styles.sideTitle}>
              This phone
            </Text>
          </View>
          <Text variant="caption" numberOfLines={1}>
            {phone.name}
          </Text>
          <Text variant="caption" color={colors.textTertiary} numberOfLines={1}>
            {sideSummary(phone)}
          </Text>
          {isNormal ? (
            <SideTrackList
              side="phone"
              sideOnlyRows={phoneOnlyRows}
              movedRows={movedRows}
              previewResolution={previewResolution}
              maxRows={maxRows}
            />
          ) : (
            <Text variant="caption" color={colors.textTertiary} numberOfLines={3}>
              {phone.dynamicRules ?? 'No rules'}
            </Text>
          )}
        </View>
      </View>

      <View style={styles.summaryBlock}>
        <Text variant="caption" color={colors.textSecondary}>
          {diffSummary(conflict)}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: spacing.sm,
  },
  compareGrid: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  sideCard: {
    flex: 1,
    minWidth: 0,
    borderRadius: radius.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glassBorder,
    backgroundColor: colors.bgTertiary,
    padding: spacing.sm,
    gap: spacing.xs,
  },
  sideCardActive: {
    borderColor: colors.accent,
  },
  sideCardDimmed: {
    opacity: 0.48,
  },
  sideHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  sideTitle: {
    flex: 1,
    minWidth: 0,
  },
  trackRows: {
    gap: spacing.xs,
    marginTop: spacing.xs,
  },
  trackGroup: {
    gap: spacing.xs,
  },
  sectionLabel: {
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  trackRow: {
    minHeight: 42,
    borderRadius: radius.sm,
    backgroundColor: colors.bgSecondary,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  trackRowAdded: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.accent,
  },
  trackRowSeparate: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glassBorder,
  },
  trackRowRemoved: {
    opacity: 0.46,
  },
  trackText: {
    flex: 1,
    minWidth: 0,
  },
  trackBadge: {
    maxWidth: 104,
  },
  summaryBlock: {
    borderRadius: radius.sm,
    backgroundColor: colors.bgTertiary,
    padding: spacing.sm,
    gap: spacing.xs,
  },
});

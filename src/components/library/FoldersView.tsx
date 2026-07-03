import { useMemo, useState } from 'react';
import {
  Pressable,
  StyleSheet,
  View,
  type GestureResponderEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { FlashList } from '@shopify/flash-list';
import { Text } from '@/components/Text';
import { TrackActionsSheet } from '@/components/library/TrackActionsSheet';
import { PullSearchScrollView } from '@/components/search/PullSearchGesture';
import { playTracks } from '@/audio/playbackController';
import { dbTrackToTrack } from '@/library/trackAdapter';
import {
  buildFolderTree,
  flattenFolderTree,
  type FlattenedFolderTreeRow,
} from '@/library/folderTree';
import { formatDuration } from '@/lib/format';
import { colors, radius, spacing } from '@/theme';
import { useLibraryStore } from '@/stores/libraryStore';
import { usePlayerStore } from '@/stores/playerStore';
import type { DbTrack } from '@/types/library';

interface FoldersViewProps {
  onScroll?: (event: NativeSyntheticEvent<NativeScrollEvent>) => void;
  scrollEventThrottle?: number;
}

function FolderRow({
  row,
  onToggle,
}: {
  row: Extract<FlattenedFolderTreeRow, { type: 'folder' }>;
  onToggle: (nodeId: string) => void;
}) {
  const { node, depth, isExpanded } = row;

  return (
    <Pressable
      style={styles.folderRow}
      onPress={() => onToggle(node.id)}
      accessibilityRole="button"
      accessibilityState={{ expanded: isExpanded }}
    >
      <View style={[styles.indent, { width: depth * 18 }]} />
      <Ionicons
        name={isExpanded ? 'chevron-down' : 'chevron-forward'}
        size={16}
        color={colors.textTertiary}
      />
      <Ionicons
        name={node.available ? 'folder-outline' : 'alert-circle-outline'}
        size={19}
        color={node.available ? colors.textSecondary : colors.warning}
      />
      <View style={styles.folderMeta}>
        <Text variant="body" numberOfLines={1}>
          {node.name}
        </Text>
        {!node.available ? (
          <Text variant="caption" color={colors.warning} numberOfLines={1}>
            Access lost
          </Text>
        ) : null}
      </View>
      <Text variant="mono" style={styles.count}>
        {node.totalTrackCount}
      </Text>
    </Pressable>
  );
}

function FolderTrackRow({
  row,
  active,
  onOpenActions,
}: {
  row: Extract<FlattenedFolderTreeRow, { type: 'track' }>;
  active: boolean;
  onOpenActions: () => void;
}) {
  const index = row.folderTracks.findIndex((track) => track.path === row.track.path);

  const playFolderTrack = () => {
    void playTracks(row.folderTracks.map(dbTrackToTrack), Math.max(0, index));
  };
  const openActions = (event: GestureResponderEvent) => {
    event.stopPropagation();
    onOpenActions();
  };

  return (
    <Pressable
      style={[styles.trackRow, active && styles.trackRowActive]}
      onPress={playFolderTrack}
      onLongPress={onOpenActions}
      accessibilityRole="button"
    >
      <View style={[styles.indent, { width: row.depth * 18 + 16 }]} />
      <Ionicons name={active ? 'volume-high' : 'musical-note'} size={15} color={active ? colors.accent : colors.textTertiary} />
      <View style={styles.trackMeta}>
        <Text variant="body" style={[styles.trackTitle, active && styles.trackTitleActive]} numberOfLines={1}>
          {row.track.title}
        </Text>
        <Text variant="label" numberOfLines={1}>
          {row.track.artist}
        </Text>
      </View>
      <Text variant="mono" style={styles.duration}>
        {formatDuration(row.track.duration)}
      </Text>
      <Pressable
        style={({ pressed }) => [styles.actionsButton, pressed && styles.actionsButtonPressed]}
        onPress={openActions}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel={`More actions for ${row.track.title}`}
      >
        <Ionicons name="ellipsis-horizontal" size={18} color={colors.textTertiary} />
      </Pressable>
    </Pressable>
  );
}

export function FoldersView({ onScroll, scrollEventThrottle }: FoldersViewProps) {
  const folders = useLibraryStore((s) => s.folders);
  const tracks = useLibraryStore((s) => s.tracks);
  const currentPath = usePlayerStore((s) => s.currentTrack?.path);
  const [expandedNodeIds, setExpandedNodeIds] = useState<Set<string>>(() => new Set());
  const [actionTrack, setActionTrack] = useState<DbTrack | null>(null);

  const tree = useMemo(() => buildFolderTree(folders, tracks), [folders, tracks]);
  const rows = useMemo(() => flattenFolderTree(tree, expandedNodeIds), [expandedNodeIds, tree]);

  const toggleFolder = (nodeId: string) => {
    setExpandedNodeIds((current) => {
      const next = new Set(current);
      if (next.has(nodeId)) {
        next.delete(nodeId);
      } else {
        next.add(nodeId);
      }
      return next;
    });
  };

  if (tree.length === 0) {
    return (
      <View style={styles.empty}>
        <Ionicons name="folder-open-outline" size={36} color={colors.textTertiary} />
        <Text variant="heading">No folders with tracks</Text>
        <Text variant="body" color={colors.textSecondary} style={styles.emptyText}>
          Add or rescan local folders in Settings.
        </Text>
      </View>
    );
  }

  return (
    <>
      <FlashList
        data={rows}
        keyExtractor={(row) => row.id}
        showsVerticalScrollIndicator={false}
        overScrollMode="never"
        renderScrollComponent={PullSearchScrollView}
        onScroll={onScroll}
        scrollEventThrottle={scrollEventThrottle}
        contentContainerStyle={styles.listContent}
        renderItem={({ item }) =>
          item.type === 'folder' ? (
            <FolderRow row={item} onToggle={toggleFolder} />
          ) : (
            <FolderTrackRow
              row={item}
              active={item.track.path === currentPath}
              onOpenActions={() => setActionTrack(item.track)}
            />
          )
        }
      />
      <TrackActionsSheet track={actionTrack} onClose={() => setActionTrack(null)} />
    </>
  );
}

const styles = StyleSheet.create({
  listContent: {
    paddingBottom: spacing.xxl,
  },
  indent: {
    flexShrink: 0,
  },
  folderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 48,
    gap: spacing.sm,
    borderBottomColor: colors.glassBorder,
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingVertical: spacing.sm,
  },
  folderMeta: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  count: {
    minWidth: 34,
    textAlign: 'right',
    color: colors.textTertiary,
    fontSize: 12,
  },
  trackRow: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 46,
    gap: spacing.sm,
    borderBottomColor: colors.glassBorder,
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingVertical: spacing.sm,
  },
  trackRowActive: {
    backgroundColor: colors.accentGlow,
  },
  trackMeta: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  trackTitle: {
    fontSize: 15,
  },
  trackTitleActive: {
    color: colors.accent,
  },
  duration: {
    minWidth: 42,
    textAlign: 'right',
    color: colors.textTertiary,
    fontSize: 12,
  },
  actionsButton: {
    width: 34,
    height: 34,
    flexShrink: 0,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionsButtonPressed: {
    backgroundColor: colors.glassBg,
  },
  empty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingBottom: spacing.xxl,
  },
  emptyText: {
    textAlign: 'center',
    maxWidth: 260,
  },
});

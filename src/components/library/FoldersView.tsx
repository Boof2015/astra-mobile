import { useMemo, useState } from 'react';
import {
  Pressable,
  StyleSheet,
  View,
  type GestureResponderEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { FlashList } from '@shopify/flash-list';
import { Text } from '@/components/Text';
import { TrackActionsSheet } from '@/components/library/TrackActionsSheet';
import {
  AppSheet,
  AppSheetItem,
  AppSheetTitle
} from '@/components/sheets/AppSheet';
import { PullSearchScrollView } from '@/components/search/PullSearchGesture';
import {
  playTracks,
  shuffleTracks,
  enqueueTopMany,
  enqueueEndMany
} from '@/audio/playbackController';
import { dbTrackToTrack } from '@/library/trackAdapter';
import {
  buildFolderTree,
  flattenFolderTree,
  type FlattenedFolderTreeRow,
  type FolderTreeNode
} from '@/library/folderTree';
import { formatDuration } from '@/lib/format';
import { playHaptic } from '@/lib/haptics';
import {
  radius,
  spacing,
} from '@/theme';
import { createThemedStyles, useColors } from '@/theme/themed';
import { SCROLL_PRESS_DELAY, useRipple } from '@/theme/ripple';
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
  onPlay,
  onShuffle,
  onOpenActions,
}: {
  row: Extract<FlattenedFolderTreeRow, { type: 'folder' }>;
  onToggle: (nodeId: string) => void;
  onPlay: (node: FolderTreeNode) => void;
  onShuffle: (node: FolderTreeNode) => void;
  onOpenActions: (node: FolderTreeNode) => void;
}) {
  const styles = useStyles();
  const colors = useColors();
  const ripple = useRipple();
  const { node, depth, isExpanded } = row;

  const play = (event: GestureResponderEvent) => {
    event.stopPropagation();
    onPlay(node);
  };
  const shuffle = (event: GestureResponderEvent) => {
    event.stopPropagation();
    onShuffle(node);
  };

  return (
    <Pressable
      android_ripple={ripple.bounded} unstable_pressDelay={SCROLL_PRESS_DELAY}
      style={styles.folderRow}
      onPress={() => onToggle(node.id)}
      onLongPress={() => {
        playHaptic('holdAccepted');
        onOpenActions(node);
      }}
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
      <Pressable
        android_ripple={ripple.icon(20)} unstable_pressDelay={SCROLL_PRESS_DELAY}
        style={styles.folderButton}
        onPress={play}
        hitSlop={6}
        accessibilityRole="button"
        accessibilityLabel={`Play ${node.name}`}
      >
        <Ionicons name="play" size={16} color={colors.accent} />
      </Pressable>
      <Pressable
        android_ripple={ripple.icon(20)} unstable_pressDelay={SCROLL_PRESS_DELAY}
        style={styles.folderButton}
        onPress={shuffle}
        hitSlop={6}
        accessibilityRole="button"
        accessibilityLabel={`Shuffle ${node.name}`}
      >
        <Ionicons name="shuffle" size={16} color={colors.textSecondary} />
      </Pressable>
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
  const styles = useStyles();
  const colors = useColors();
  const ripple = useRipple();
  const index = row.folderTracks.findIndex((track) => track.path === row.track.path);

  const playFolderTrack = () => {
    void playTracks(row.folderTracks.map(dbTrackToTrack), {
      startIndex: Math.max(0, index),
      source: { kind: 'folder', label: row.folderName },
    });
  };
  const openActions = (event: GestureResponderEvent) => {
    event.stopPropagation();
    onOpenActions();
  };

  return (
    <Pressable
      android_ripple={ripple.bounded} unstable_pressDelay={SCROLL_PRESS_DELAY}
      style={[styles.trackRow, active && styles.trackRowActive]}
      onPress={playFolderTrack}
      onLongPress={() => {
        playHaptic('holdAccepted');
        onOpenActions();
      }}
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
        android_ripple={ripple.icon(21)} unstable_pressDelay={SCROLL_PRESS_DELAY}
        style={styles.actionsButton}
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
  const styles = useStyles();
  const colors = useColors();
  const folders = useLibraryStore((s) => s.folders);
  const tracks = useLibraryStore((s) => s.tracks);
  const currentPath = usePlayerStore((s) => s.currentTrack?.path);
  const [expandedNodeIds, setExpandedNodeIds] = useState<Set<string>>(() => new Set());
  const [actionTrack, setActionTrack] = useState<DbTrack | null>(null);
  const [actionFolder, setActionFolder] = useState<FolderTreeNode | null>(null);

  const tree = useMemo(() => buildFolderTree(folders, tracks), [folders, tracks]);
  const rows = useMemo(() => flattenFolderTree(tree, expandedNodeIds), [expandedNodeIds, tree]);

  // Folder-level playback runs the whole subtree (subfolders included), in tree order.
  const playFolder = (node: FolderTreeNode) => {
    if (node.subtreeTracks.length === 0) return;
    void playTracks(node.subtreeTracks.map(dbTrackToTrack), {
      source: { kind: 'folder', label: node.name },
    });
  };
  const shuffleFolder = (node: FolderTreeNode) => {
    if (node.subtreeTracks.length === 0) return;
    void shuffleTracks(node.subtreeTracks.map(dbTrackToTrack), {
      kind: 'folder',
      label: node.name,
    });
  };
  const playFolderNext = (node: FolderTreeNode) => {
    if (node.subtreeTracks.length === 0) return;
    void enqueueTopMany(node.subtreeTracks.map(dbTrackToTrack));
  };
  const queueFolder = (node: FolderTreeNode) => {
    if (node.subtreeTracks.length === 0) return;
    void enqueueEndMany(node.subtreeTracks.map(dbTrackToTrack));
  };

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
            <FolderRow
              row={item}
              onToggle={toggleFolder}
              onPlay={playFolder}
              onShuffle={shuffleFolder}
              onOpenActions={setActionFolder}
            />
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
      {actionFolder ? (
        <AppSheet onClose={() => setActionFolder(null)}>
          <AppSheetTitle
            title={actionFolder.name}
            subtitle={`${actionFolder.totalTrackCount} ${actionFolder.totalTrackCount === 1 ? 'track' : 'tracks'}`}
          />
          <AppSheetItem
            label="Play"
            icon="play"
            onPress={() => {
              playFolder(actionFolder);
              setActionFolder(null);
            }}
          />
          <AppSheetItem
            label="Shuffle"
            icon="shuffle"
            onPress={() => {
              shuffleFolder(actionFolder);
              setActionFolder(null);
            }}
          />
          <AppSheetItem
            label="Play next"
            icon="play-skip-forward"
            onPress={() => {
              playFolderNext(actionFolder);
              setActionFolder(null);
            }}
          />
          <AppSheetItem
            label="Add to queue"
            icon="list-outline"
            onPress={() => {
              queueFolder(actionFolder);
              setActionFolder(null);
            }}
          />
        </AppSheet>
      ) : null}
    </>
  );
}

const useStyles = createThemedStyles((colors) => ({
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
  folderButton: {
    width: 32,
    height: 32,
    flexShrink: 0,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
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
}));

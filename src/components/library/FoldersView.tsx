import { useEffect, useMemo, useState } from 'react';
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
import {
  AstraLibraryData,
  type NativeFolderNode,
} from '../../../modules/astra-library-scanner';
import { Text } from '@/components/Text';
import { TrackActionsSheet } from '@/components/library/TrackActionsSheet';
import {
  AppSheet,
  AppSheetItem,
  AppSheetTitle,
} from '@/components/sheets/AppSheet';
import { PullSearchScrollView } from '@/components/search/PullSearchGesture';
import {
  enqueueLibraryQuery,
  playLibraryQuery,
} from '@/audio/playbackController';
import { formatDuration } from '@/lib/format';
import { playHaptic } from '@/lib/haptics';
import { spacing } from '@/theme';
import { createThemedStyles, useColors } from '@/theme/themed';
import { SCROLL_PRESS_DELAY, useRipple } from '@/theme/ripple';
import { usePlayerStore } from '@/stores/playerStore';
import type { DbTrack } from '@/types/library';

const PAGE_SIZE = 100;

interface FoldersViewProps {
  onScroll?: (event: NativeSyntheticEvent<NativeScrollEvent>) => void;
  scrollEventThrottle?: number;
}

interface LoadedNode {
  node: NativeFolderNode;
  childIds: string[];
  tracks: DbTrack[];
  nextOffset: number | null;
  loaded: boolean;
  loading: boolean;
}

type FolderRow =
  | { type: 'folder'; id: string; state: LoadedNode; expanded: boolean }
  | { type: 'track'; id: string; track: DbTrack; node: NativeFolderNode }
  | { type: 'more'; id: string; nodeId: string; depth: number };

function FolderNodeRow({
  state,
  expanded,
  onToggle,
  onPlay,
  onShuffle,
  onOpenActions,
}: {
  state: LoadedNode;
  expanded: boolean;
  onToggle: () => void;
  onPlay: () => void;
  onShuffle: () => void;
  onOpenActions: () => void;
}) {
  const styles = useStyles();
  const colors = useColors();
  const ripple = useRipple();
  const { node } = state;
  const stop = (callback: () => void) => (event: GestureResponderEvent) => {
    event.stopPropagation();
    callback();
  };
  return (
    <Pressable
      android_ripple={ripple.bounded}
      unstable_pressDelay={SCROLL_PRESS_DELAY}
      style={styles.folderRow}
      onPress={onToggle}
      onLongPress={() => {
        playHaptic('holdAccepted');
        onOpenActions();
      }}
      accessibilityRole="button"
      accessibilityState={{ expanded }}
    >
      <View style={[styles.indent, { width: node.depth * 18 }]} />
      <Ionicons
        name={state.loading ? 'ellipsis-horizontal' : expanded ? 'chevron-down' : 'chevron-forward'}
        size={16}
        color={colors.textTertiary}
      />
      <Ionicons
        name={node.available ? 'folder-outline' : 'alert-circle-outline'}
        size={19}
        color={node.available ? colors.textSecondary : colors.warning}
      />
      <View style={styles.folderMeta}>
        <Text variant="body" numberOfLines={1}>{node.name}</Text>
        {!node.available ? (
          <Text variant="caption" color={colors.warning}>Access lost</Text>
        ) : null}
      </View>
      <Text variant="mono" style={styles.count}>{node.totalTrackCount}</Text>
      <Pressable
        android_ripple={ripple.icon(20)}
        unstable_pressDelay={SCROLL_PRESS_DELAY}
        style={styles.folderButton}
        onPress={stop(onPlay)}
        hitSlop={6}
        accessibilityRole="button"
        accessibilityLabel={`Play ${node.name}`}
      >
        <Ionicons name="play" size={16} color={colors.accent} />
      </Pressable>
      <Pressable
        android_ripple={ripple.icon(20)}
        unstable_pressDelay={SCROLL_PRESS_DELAY}
        style={styles.folderButton}
        onPress={stop(onShuffle)}
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
  track,
  node,
  active,
  onOpenActions,
}: {
  track: DbTrack;
  node: NativeFolderNode;
  active: boolean;
  onOpenActions: () => void;
}) {
  const styles = useStyles();
  const colors = useColors();
  const ripple = useRipple();
  return (
    <Pressable
      android_ripple={ripple.bounded}
      unstable_pressDelay={SCROLL_PRESS_DELAY}
      style={[styles.trackRow, active && styles.trackRowActive]}
      onPress={() => {
        void playLibraryQuery(
          { kind: 'folder', folderNodeId: node.id },
          {
            anchorPath: track.path,
            source: { kind: 'folder', label: node.name },
          }
        );
      }}
      onLongPress={() => {
        playHaptic('holdAccepted');
        onOpenActions();
      }}
      accessibilityRole="button"
    >
      <View style={[styles.indent, { width: (node.depth + 1) * 18 + 16 }]} />
      <Ionicons
        name={active ? 'volume-high' : 'musical-note'}
        size={15}
        color={active ? colors.accent : colors.textTertiary}
      />
      <View style={styles.trackMeta}>
        <Text
          variant="body"
          style={[styles.trackTitle, active && styles.trackTitleActive]}
          numberOfLines={1}
        >
          {track.title}
        </Text>
        <Text variant="label" numberOfLines={1}>{track.artist}</Text>
      </View>
      <Text variant="mono" style={styles.duration}>{formatDuration(track.duration)}</Text>
      <Pressable
        android_ripple={ripple.icon(21)}
        unstable_pressDelay={SCROLL_PRESS_DELAY}
        style={styles.actionsButton}
        onPress={(event) => {
          event.stopPropagation();
          onOpenActions();
        }}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel={`More actions for ${track.title}`}
      >
        <Ionicons name="ellipsis-horizontal" size={18} color={colors.textTertiary} />
      </Pressable>
    </Pressable>
  );
}

export function FoldersView({ onScroll, scrollEventThrottle }: FoldersViewProps) {
  const styles = useStyles();
  const colors = useColors();
  const currentPath = usePlayerStore((state) => state.currentTrack?.path);
  const [nodes, setNodes] = useState<Map<string, LoadedNode>>(() => new Map());
  const [rootIds, setRootIds] = useState<string[]>([]);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [actionTrack, setActionTrack] = useState<DbTrack | null>(null);
  const [actionFolder, setActionFolder] = useState<NativeFolderNode | null>(null);

  const replaceRoots = async () => {
    const roots = await AstraLibraryData.getFolderNodes(null);
    setNodes(new Map(roots.map((node) => [
      node.id,
      { node, childIds: [], tracks: [], nextOffset: 0, loaded: false, loading: false },
    ])));
    setRootIds(roots.map((node) => node.id));
    setExpanded(new Set());
  };

  useEffect(() => {
    queueMicrotask(() => void replaceRoots());
    const subscription = AstraLibraryData.addListener('onCatalogChanged', () => {
      void replaceRoots();
    });
    return () => subscription.remove();
  }, []);

  const loadNode = async (nodeId: string, append = false) => {
    const current = nodes.get(nodeId);
    if (!current || current.loading || (append && current.nextOffset == null)) return;
    setNodes((existing) => {
      const next = new Map(existing);
      next.set(nodeId, { ...current, loading: true });
      return next;
    });
    const offset = append ? current.nextOffset ?? 0 : 0;
    const [children, page] = await Promise.all([
      append ? Promise.resolve([]) : AstraLibraryData.getFolderNodes(nodeId),
      AstraLibraryData.getFolderTracks<DbTrack>(nodeId, offset, PAGE_SIZE),
    ]);
    setNodes((existing) => {
      const next = new Map(existing);
      for (const child of children) {
        const old = next.get(child.id);
        next.set(child.id, old ?? {
          node: child,
          childIds: [],
          tracks: [],
          nextOffset: 0,
          loaded: false,
          loading: false,
        });
      }
      const latest = next.get(nodeId) ?? current;
      next.set(nodeId, {
        ...latest,
        childIds: append ? latest.childIds : children.map((child) => child.id),
        tracks: append ? [...latest.tracks, ...page.items] : page.items,
        nextOffset: page.nextOffset,
        loaded: true,
        loading: false,
      });
      return next;
    });
  };

  const toggleNode = (nodeId: string) => {
    const opening = !expanded.has(nodeId);
    setExpanded((current) => {
      const next = new Set(current);
      if (opening) next.add(nodeId);
      else next.delete(nodeId);
      return next;
    });
    if (opening && !nodes.get(nodeId)?.loaded) void loadNode(nodeId);
  };

  const rows = useMemo(() => {
    const result: FolderRow[] = [];
    const visit = (id: string) => {
      const state = nodes.get(id);
      if (!state) return;
      const isExpanded = expanded.has(id);
      result.push({ type: 'folder', id, state, expanded: isExpanded });
      if (!isExpanded) return;
      for (const childId of state.childIds) visit(childId);
      for (const track of state.tracks) {
        result.push({ type: 'track', id: `track:${id}:${track.path}`, track, node: state.node });
      }
      if (state.nextOffset != null) {
        result.push({ type: 'more', id: `more:${id}:${state.nextOffset}`, nodeId: id, depth: state.node.depth + 1 });
      }
    };
    rootIds.forEach(visit);
    return result;
  }, [expanded, nodes, rootIds]);

  const playFolder = (node: NativeFolderNode, shuffle = false) => {
    if (node.totalTrackCount === 0) return;
    void playLibraryQuery(
      { kind: 'folder', folderNodeId: node.id },
      {
        shuffle,
        source: { kind: 'folder', label: node.name },
      }
    );
  };

  if (rootIds.length === 0) {
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
        renderItem={({ item }) => {
          if (item.type === 'folder') {
            return (
              <FolderNodeRow
                state={item.state}
                expanded={item.expanded}
                onToggle={() => toggleNode(item.id)}
                onPlay={() => playFolder(item.state.node)}
                onShuffle={() => playFolder(item.state.node, true)}
                onOpenActions={() => setActionFolder(item.state.node)}
              />
            );
          }
          if (item.type === 'more') {
            return (
              <Pressable
                style={[styles.moreRow, { paddingLeft: item.depth * 18 + 16 }]}
                onPress={() => void loadNode(item.nodeId, true)}
              >
                <Text variant="label" color={colors.accent}>Load more tracks</Text>
              </Pressable>
            );
          }
          return (
            <FolderTrackRow
              track={item.track}
              node={item.node}
              active={item.track.path === currentPath}
              onOpenActions={() => setActionTrack(item.track)}
            />
          );
        }}
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
              playFolder(actionFolder, true);
              setActionFolder(null);
            }}
          />
          <AppSheetItem
            label="Play next"
            icon="play-skip-forward"
            onPress={() => {
              void enqueueLibraryQuery(
                { kind: 'folder', folderNodeId: actionFolder.id },
                'next',
              );
              setActionFolder(null);
            }}
          />
          <AppSheetItem
            label="Add to queue"
            icon="list-outline"
            onPress={() => {
              void enqueueLibraryQuery(
                { kind: 'folder', folderNodeId: actionFolder.id },
                'end',
              );
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
  },
  count: {
    color: colors.textTertiary,
  },
  folderButton: {
    width: 34,
    height: 34,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 17,
  },
  trackRow: {
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderBottomColor: colors.glassBorder,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  trackRowActive: {
    backgroundColor: colors.bgSecondary,
  },
  trackMeta: {
    flex: 1,
    minWidth: 0,
  },
  trackTitle: {
    color: colors.textPrimary,
  },
  trackTitleActive: {
    color: colors.accent,
  },
  duration: {
    color: colors.textTertiary,
  },
  actionsButton: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 18,
  },
  moreRow: {
    minHeight: 44,
    justifyContent: 'center',
    borderBottomColor: colors.glassBorder,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  empty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.xl,
  },
  emptyText: {
    textAlign: 'center',
  },
}));

import { ActionButton } from '@/components/ActionButton';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  ActivityIndicator,
  BackHandler,
  Pressable,
  StyleSheet,
  View,
  type GestureResponderEvent,
} from 'react-native';
import type { ScrollHandlerProcessed } from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from 'expo-router';
import {
  AstraLibraryData,
  type NativeFolderNode,
} from '../../../modules/astra-library-scanner';
import { Text } from '@/components/Text';
import { ReanimatedFlashList } from '@/components/ReanimatedFlashList';
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
import { AppPressable, SCROLL_PRESS_DELAY } from '@/components/AppPressable';
import { usePlayerStore } from '@/stores/playerStore';
import type { DbTrack } from '@/types/library';
import { useSceneBottomInset } from '@/navigation/useShellLayout';
import type { ScrollToTopHandle } from '@/navigation/scrollToTopHandle';
import { TrackRow } from '@/components/library/TrackRow';
import {
  currentFolderId,
  enterFolder,
  folderBrowserRows,
  leaveFolder,
} from '@/library/folderBrowser';

const PAGE_SIZE = 100;

export type FolderActionTarget = NativeFolderNode;

interface FoldersViewProps {
  presentation: 'browser' | 'tree';
  onScroll?: ScrollHandlerProcessed;
  scrollEventThrottle?: number;
  /** What the list owes so it clears Library's collapsing header. */
  contentPaddingTop?: number;
  contentPaddingBottom?: number;
  /** Phone-only scan/error content that scrolls away with the folder rows. */
  listHeader?: ReactNode;
  /** Lets the Library screen send this list back to the top on a tab re-tap. */
  listRef?: (list: ScrollToTopHandle | null) => void;
  /** Hoists sheets above Library's persistent section bar. */
  onOpenTrackActions: (track: DbTrack) => void;
  onOpenFolderActions: (folder: NativeFolderNode) => void;
  /** Keeps Library's collapsing header and pull-search gate at the new directory's top. */
  onBrowserLocationChange?: () => void;
}

interface LoadedNode {
  node: NativeFolderNode;
  childIds: string[];
  tracks: DbTrack[];
  nextOffset: number | null;
  loaded: boolean;
  loading: boolean;
}

type TreeFolderRow =
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
  const { node } = state;
  const stop = (callback: () => void) => (event: GestureResponderEvent) => {
    event.stopPropagation();
    callback();
  };
  return (
    <AppPressable

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
      <AppPressable
        feedback="control"
        unstable_pressDelay={SCROLL_PRESS_DELAY}
        style={styles.folderButton}
        onPress={stop(onPlay)}
        hitSlop={6}
        accessibilityRole="button"
        accessibilityLabel={`Play ${node.name}`}
      >
        <Ionicons name="play" size={16} color={colors.accent} />
      </AppPressable>
      <AppPressable
        feedback="control"
        unstable_pressDelay={SCROLL_PRESS_DELAY}
        style={styles.folderButton}
        onPress={stop(onShuffle)}
        hitSlop={6}
        accessibilityRole="button"
        accessibilityLabel={`Shuffle ${node.name}`}
      >
        <Ionicons name="shuffle" size={16} color={colors.textSecondary} />
      </AppPressable>
    </AppPressable>
  );
}

function BrowserFolderRow({
  node,
  onOpen,
  onOpenActions,
}: {
  node: NativeFolderNode;
  onOpen: () => void;
  onOpenActions: () => void;
}) {
  const styles = useStyles();
  const colors = useColors();
  const countLabel = `${node.totalTrackCount} ${node.totalTrackCount === 1 ? 'track' : 'tracks'}`;
  return (
    <AppPressable
      unstable_pressDelay={SCROLL_PRESS_DELAY}
      style={styles.browserFolderRow}
      onPress={onOpen}
      onLongPress={() => {
        playHaptic('holdAccepted');
        onOpenActions();
      }}
      accessibilityRole="button"
      accessibilityLabel={`${node.name}, folder, ${countLabel}`}
    >
      <Ionicons
        name={node.available ? 'folder-outline' : 'alert-circle-outline'}
        size={24}
        color={node.available ? colors.textSecondary : colors.warning}
      />
      <View style={styles.browserFolderMeta}>
        <Text variant="body" numberOfLines={1}>{node.name}</Text>
        <Text
          variant="label"
          numberOfLines={1}
          color={node.available ? colors.textSecondary : colors.warning}
        >
          {node.available ? countLabel : `Access lost · ${countLabel}`}
        </Text>
      </View>
      <Ionicons name="chevron-forward" size={20} color={colors.textTertiary} />
    </AppPressable>
  );
}

function BrowserDirectoryHeader({
  state,
  onPlay,
  onShuffle,
  onOpenActions,
}: {
  state: LoadedNode;
  onPlay: () => void;
  onShuffle: () => void;
  onOpenActions: () => void;
}) {
  const styles = useStyles();
  const colors = useColors();
  const { node } = state;
  const empty = node.totalTrackCount === 0;
  return (
    <AppPressable
      unstable_pressDelay={SCROLL_PRESS_DELAY}
      style={styles.browserDirectoryHeader}
      onLongPress={() => {
        playHaptic('holdAccepted');
        onOpenActions();
      }}
      accessibilityRole="summary"
    >
      <View style={styles.browserDirectoryMeta}>
        <Text variant="heading" numberOfLines={1}>{node.name}</Text>
        <View style={styles.browserDirectoryCountRow}>
          <Text variant="label" numberOfLines={1}>
            {node.totalTrackCount} {node.totalTrackCount === 1 ? 'track' : 'tracks'}
          </Text>
          {state.loading ? <ActivityIndicator size="small" color={colors.textTertiary} /> : null}
        </View>
      </View>
      <View style={styles.browserDirectoryActions}>
        <AppPressable
          feedback="control"
          style={styles.browserDirectoryButton}
          onPress={(event) => {
            event.stopPropagation();
            onPlay();
          }}
          disabled={empty}
          accessibilityRole="button"
          accessibilityLabel={`Play ${node.name}`}
        >
          <Ionicons name="play" size={20} color={empty ? colors.textTertiary : colors.accent} />
        </AppPressable>
        <AppPressable
          feedback="control"
          style={styles.browserDirectoryButton}
          onPress={(event) => {
            event.stopPropagation();
            onShuffle();
          }}
          disabled={empty}
          accessibilityRole="button"
          accessibilityLabel={`Shuffle ${node.name}`}
        >
          <Ionicons name="shuffle" size={20} color={colors.textSecondary} />
        </AppPressable>
      </View>
    </AppPressable>
  );
}

function BrowserUpRow({ label, onPress }: { label: string; onPress: () => void }) {
  const styles = useStyles();
  const colors = useColors();
  return (
    <AppPressable
      unstable_pressDelay={SCROLL_PRESS_DELAY}
      style={styles.browserFolderRow}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Up to ${label}`}
    >
      <Ionicons name="return-up-back-outline" size={24} color={colors.textSecondary} />
      <View style={styles.browserFolderMeta}>
        <Text variant="body">..</Text>
        <Text variant="label" numberOfLines={1}>{label}</Text>
      </View>
    </AppPressable>
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
  return (
    <AppPressable

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
      <AppPressable
        feedback="control"
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
      </AppPressable>
    </AppPressable>
  );
}

export function FoldersView({
  presentation,
  onScroll,
  scrollEventThrottle,
  contentPaddingTop = 0,
  contentPaddingBottom,
  listHeader,
  listRef,
  onOpenTrackActions,
  onOpenFolderActions,
  onBrowserLocationChange,
}: FoldersViewProps) {
  const sceneBottomInset = useSceneBottomInset();
  const styles = useStyles();
  const colors = useColors();
  const currentPath = usePlayerStore((state) => state.currentTrack?.path);
  const [nodes, setNodes] = useState<Map<string, LoadedNode>>(() => new Map());
  const [rootIds, setRootIds] = useState<string[]>([]);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [browserPath, setBrowserPath] = useState<string[]>([]);

  const replaceRoots = async () => {
    const roots = await AstraLibraryData.getFolderNodes(null);
    setNodes(new Map(roots.map((node) => [
      node.id,
      { node, childIds: [], tracks: [], nextOffset: 0, loaded: false, loading: false },
    ])));
    setRootIds(roots.map((node) => node.id));
    setExpanded(new Set());
    setBrowserPath([]);
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
    const result: TreeFolderRow[] = [];
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

  const browserRows = useMemo(
    () => folderBrowserRows({
      path: browserPath,
      rootIds,
      nodes,
      trackId: (track: DbTrack) => track.path,
    }),
    [browserPath, nodes, rootIds],
  );
  const browserNodeId = currentFolderId(browserPath);
  const browserState = browserNodeId == null ? null : nodes.get(browserNodeId) ?? null;
  const browserLocationKey = browserPath.join('\u0000');

  useEffect(() => {
    if (presentation === 'browser') onBrowserLocationChange?.();
  }, [browserLocationKey, onBrowserLocationChange, presentation]);

  const enterBrowserFolder = (nodeId: string) => {
    setBrowserPath((path) => enterFolder(path, nodeId));
    if (!nodes.get(nodeId)?.loaded) void loadNode(nodeId);
  };

  const leaveBrowserFolder = () => {
    setBrowserPath((path) => leaveFolder(path) ?? path);
  };

  useFocusEffect(
    useCallback(() => {
      if (presentation !== 'browser' || browserPath.length === 0) return undefined;
      const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
        const parent = leaveFolder(browserPath);
        if (parent == null) return false;
        setBrowserPath(parent);
        return true;
      });
      return () => subscription.remove();
    }, [browserPath, presentation]),
  );

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
      <View
        style={[
          styles.emptyShell,
          {
            paddingTop: contentPaddingTop,
            paddingBottom: contentPaddingBottom ?? sceneBottomInset,
          },
        ]}
      >
        {listHeader}
        <View style={styles.empty}>
          <Ionicons name="folder-open-outline" size={36} color={colors.textTertiary} />
          <Text variant="heading">No folders with tracks</Text>
          <Text variant="body" color={colors.textSecondary} style={styles.emptyText}>
            Add or rescan local folders in Settings.
          </Text>
        </View>
      </View>
    );
  }

  if (presentation === 'browser') {
    const parentName = browserPath.length > 1
      ? nodes.get(browserPath[browserPath.length - 2])?.node.name ?? 'Parent folder'
      : 'Folder roots';
    return (
      <ReanimatedFlashList
        key={`folder-browser:${browserNodeId ?? 'root'}`}
        ref={listRef}
        data={browserRows}
        keyExtractor={(row) => row.id}
        showsVerticalScrollIndicator={false}
        overScrollMode="never"
        renderScrollComponent={PullSearchScrollView}
        onScroll={onScroll}
        scrollEventThrottle={scrollEventThrottle}
        contentContainerStyle={{
          paddingTop: contentPaddingTop,
          paddingHorizontal: spacing.lg,
          paddingBottom: contentPaddingBottom ?? sceneBottomInset,
        }}
        ListHeaderComponent={
          <>
            {listHeader}
            {browserState ? (
              <BrowserDirectoryHeader
                state={browserState}
                onPlay={() => playFolder(browserState.node)}
                onShuffle={() => playFolder(browserState.node, true)}
                onOpenActions={() => onOpenFolderActions(browserState.node)}
              />
            ) : null}
          </>
        }
        ListFooterComponent={
          browserState?.loaded &&
          browserState.childIds.length === 0 &&
          browserState.tracks.length === 0 ? (
            <View style={styles.browserEmpty}>
              <Text variant="body" color={colors.textSecondary}>This folder is empty.</Text>
            </View>
          ) : null
        }
        renderItem={({ item }) => {
          if (item.type === 'up') {
            return <BrowserUpRow label={parentName} onPress={leaveBrowserFolder} />;
          }
          if (item.type === 'folder') {
            return (
              <BrowserFolderRow
                node={item.node}
                onOpen={() => enterBrowserFolder(item.node.id)}
                onOpenActions={() => onOpenFolderActions(item.node)}
              />
            );
          }
          if (item.type === 'more') {
            return (
              <ActionButton
                unstable_pressDelay={SCROLL_PRESS_DELAY}
                onPress={() => void loadNode(item.nodeId, true)}
                variant="secondary"
                label="Load more tracks"
                style={{ marginHorizontal: spacing.lg, marginVertical: spacing.sm }}
              />
            );
          }
          if (!browserState) return null;
          return (
            <TrackRow
              track={item.track}
              active={item.track.path === currentPath}
              onPress={() => {
                void playLibraryQuery(
                  { kind: 'folder', folderNodeId: browserState.node.id },
                  {
                    anchorPath: item.track.path,
                    source: { kind: 'folder', label: browserState.node.name },
                  },
                );
              }}
              onLongPress={() => onOpenTrackActions(item.track)}
              onOpenActions={() => onOpenTrackActions(item.track)}
            />
          );
        }}
      />
    );
  }

  return (
    <>
      <ReanimatedFlashList
        ref={listRef}
        data={rows}
        keyExtractor={(row) => row.id}
        showsVerticalScrollIndicator={false}
        overScrollMode="never"
        renderScrollComponent={PullSearchScrollView}
        onScroll={onScroll}
        scrollEventThrottle={scrollEventThrottle}
        contentContainerStyle={{
          paddingTop: contentPaddingTop,
          paddingHorizontal: spacing.lg,
          paddingBottom: contentPaddingBottom ?? sceneBottomInset,
        }}
        ListHeaderComponent={listHeader ? <>{listHeader}</> : undefined}
        renderItem={({ item }) => {
          if (item.type === 'folder') {
            return (
              <FolderNodeRow
                state={item.state}
                expanded={item.expanded}
                onToggle={() => toggleNode(item.id)}
                onPlay={() => playFolder(item.state.node)}
                onShuffle={() => playFolder(item.state.node, true)}
                onOpenActions={() => onOpenFolderActions(item.state.node)}
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
              onOpenActions={() => onOpenTrackActions(item.track)}
            />
          );
        }}
      />
    </>
  );
}

/** Screen-level overlay so the sheet paints above the persistent Library bar. */
export function FolderActionsSheet({
  folder,
  onClose,
}: {
  folder: NativeFolderNode | null;
  onClose: () => void;
}) {
  if (!folder) return null;

  const play = (shuffle = false) => {
    if (folder.totalTrackCount > 0) {
      void playLibraryQuery(
        { kind: 'folder', folderNodeId: folder.id },
        {
          shuffle,
          source: { kind: 'folder', label: folder.name },
        }
      );
    }
    onClose();
  };

  const enqueue = (position: 'next' | 'end') => {
    void enqueueLibraryQuery(
      { kind: 'folder', folderNodeId: folder.id },
      position,
    );
    onClose();
  };

  return (
    <AppSheet onClose={onClose}>
      <AppSheetTitle
        title={folder.name}
        subtitle={`${folder.totalTrackCount} ${folder.totalTrackCount === 1 ? 'track' : 'tracks'}`}
      />
      <AppSheetItem label="Play" icon="play" onPress={() => play()} />
      <AppSheetItem label="Shuffle" icon="shuffle" onPress={() => play(true)} />
      <AppSheetItem label="Play next" icon="play-skip-forward" onPress={() => enqueue('next')} />
      <AppSheetItem label="Add to queue" icon="list-outline" onPress={() => enqueue('end')} />
    </AppSheet>
  );
}

const useStyles = createThemedStyles((colors) => ({
  emptyShell: {
    flex: 1,
    paddingHorizontal: spacing.lg,
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
  browserFolderRow: {
    minHeight: 60,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.sm,
    borderBottomColor: colors.glassBorder,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  browserFolderMeta: {
    flex: 1,
    minWidth: 0,
    gap: spacing.xs,
  },
  browserDirectoryHeader: {
    minHeight: 72,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.md,
    borderBottomColor: colors.glassBorder,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  browserDirectoryMeta: {
    flex: 1,
    minWidth: 0,
    gap: spacing.xs,
  },
  browserDirectoryCountRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  browserDirectoryActions: {
    flexDirection: 'row',
    gap: spacing.xs,
  },
  browserDirectoryButton: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 22,
  },
  browserEmpty: {
    minHeight: 96,
    alignItems: 'center',
    justifyContent: 'center',
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

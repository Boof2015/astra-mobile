import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from 'react';
import {
  Pressable,
  StyleSheet,
  View,
  useWindowDimensions
} from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import BottomSheet, {
  BottomSheetBackdrop,
  type BottomSheetBackdropProps,
  useBottomSheetScrollableCreator
} from '@gorhom/bottom-sheet';
import { FlashList, type ListRenderItemInfo } from '@shopify/flash-list';
import {
  Gesture,
  GestureDetector,
  type GestureType
} from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  runOnUI,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  type SharedValue
} from 'react-native-reanimated';
import type { Track as RntpTrack } from 'react-native-track-player';
import { Text } from '@/components/Text';
import { AstraLogo } from '@/components/AstraLogo';
import { SwipeableRow } from '@/components/SwipeableRow';
import {
  radius,
  spacing,
} from '@/theme';
import { createThemedStyles, useColors } from '@/theme/themed';
import { motion } from '@/theme/motion';
import { dragArmHaptic, tickHaptic } from '@/lib/haptics';
import { useQueueStore } from '@/stores/queueStore';
import {
  jumpToQueueIndex,
  moveQueueItem,
  removeFromQueue,
  removeManyFromQueue,
  requeueManyToTop,
  requeueToTop,
  setUpcoming
} from '@/audio/playbackController';
import { useQueue } from './useQueue';
import {
  removeQueueEntryAt,
  resolveSelectedQueueAction,
} from './queueActions';

const QUEUE_ROW_HEIGHT = 64;
const ART = 42;
const EMPTY_KEY_SET = new Set<string>();

interface QueueEntry {
  key: string;
  identity: string;
  track: RntpTrack;
}

type QueueIndexByKey = Record<string, number>;

function rntpKey(track: RntpTrack): string {
  return String(track.id ?? track.url);
}

function trackTitle(track: RntpTrack): string {
  return track.title?.trim() || 'Unknown title';
}

function trackArtist(track: RntpTrack): string {
  return track.artist?.trim() || 'Unknown artist';
}

function artworkUri(track: RntpTrack): string | undefined {
  return typeof track.artwork === 'string' ? track.artwork : undefined;
}

function queueCountLabel(count: number): string {
  if (count === 0) return 'No songs next';
  if (count === 1) return '1 song next';
  return `${count} songs next`;
}

function arrayMove<T>(items: readonly T[], from: number, to: number): T[] {
  const out = [...items];
  const [moved] = out.splice(from, 1);
  out.splice(to, 0, moved);
  return out;
}

function indexByEntryKey(entries: readonly QueueEntry[]): QueueIndexByKey {
  const out: QueueIndexByKey = {};
  entries.forEach((entry, index) => {
    out[entry.key] = index;
  });
  return out;
}

function clampLocal(value: number, len: number): number {
  'worklet';
  return Math.max(0, Math.min(len - 1, value));
}

function reconcileQueueEntries(
  tracks: readonly RntpTrack[],
  previous: readonly QueueEntry[],
  nextSerial: { current: number }
): QueueEntry[] {
  const available = new Map<string, QueueEntry[]>();
  previous.forEach((entry) => {
    const bucket = available.get(entry.identity);
    if (bucket) bucket.push(entry);
    else available.set(entry.identity, [entry]);
  });

  return tracks.map((track) => {
    const identity = rntpKey(track);
    const reused = available.get(identity)?.shift();
    if (reused) return { ...reused, track, identity };

    const key = `${identity}:${nextSerial.current}`;
    nextSerial.current += 1;
    return { key, identity, track };
  });
}

interface QueueTrayProps {
  onClose: () => void;
}

export function QueueTray({ onClose }: QueueTrayProps) {
  const styles = useStyles();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  const snapPoints = useMemo(() => ['58%', '100%'], []);
  const renderFlashListScrollComponent = useBottomSheetScrollableCreator();
  // While the sheet-open animation runs, the bottom-sheet scrollable can
  // momentarily fail to constrain the list, so FlashList measures its viewport
  // as the full CONTENT height (~100k dp for a long queue), believes every row
  // is visible, and mounts thousands of views — a multi-second main-thread
  // freeze. Clamping the list container to the window height caps the viewport
  // no matter what the sheet reports; both snap points stay unaffected.
  const listClampStyle = useMemo(() => ({ maxHeight: windowHeight }), [windowHeight]);

  const { tracks, activeIndex, hasSnapshot, refresh } = useQueue(true);
  const currentTrack = activeIndex >= 0 ? tracks[activeIndex] : undefined;
  const upcomingTracks = useMemo(
    () => (activeIndex >= 0 ? tracks.slice(activeIndex + 1) : tracks),
    [tracks, activeIndex]
  );
  const upcomingTotal =
    activeIndex >= 0 ? Math.max(0, tracks.length - activeIndex - 1) : tracks.length;
  const baseOffset = activeIndex >= 0 ? activeIndex + 1 : 0;

  const entrySerial = useRef(0);
  const entriesRef = useRef<QueueEntry[]>([]);
  const [entries, setEntries] = useState<QueueEntry[]>([]);
  const [editMode, setEditMode] = useState(false);
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());

  const dStart = useSharedValue(-1);
  const dTarget = useSharedValue(-1);
  const dTy = useSharedValue(0);
  const dActive = useSharedValue(false);
  const dKey = useSharedValue('');
  const dSettling = useSharedValue(false);
  const dIndexByKey = useSharedValue<QueueIndexByKey>({});
  // The index map is only read by worklets while a drag is active/settling, so
  // it's maintained only inside that window — serializing a map with one entry
  // per queued track to the UI runtime on every queue change froze long queues.
  const dragInFlightRef = useRef(false);

  const clearDragState = useCallback(() => {
    dragInFlightRef.current = false;
    runOnUI(
      (
        active: SharedValue<boolean>,
        ty: SharedValue<number>,
        start: SharedValue<number>,
        target: SharedValue<number>,
        key: SharedValue<string>,
        settling: SharedValue<boolean>,
        indexMap: SharedValue<QueueIndexByKey>
      ) => {
        'worklet';
        active.value = false;
        settling.value = false;
        ty.value = 0;
        start.value = -1;
        target.value = -1;
        key.value = '';
        indexMap.value = {};
      }
    )(dActive, dTy, dStart, dTarget, dKey, dSettling, dIndexByKey);
  }, [dActive, dIndexByKey, dKey, dSettling, dStart, dTarget, dTy]);

  const clearDragAfterReorderCommit = useCallback(() => {
    requestAnimationFrame(() => {
      requestAnimationFrame(clearDragState);
    });
  }, [clearDragState]);

  const updateDragIndexMap = useCallback(
    (indexMap: QueueIndexByKey) => {
      runOnUI((sharedIndexMap: SharedValue<QueueIndexByKey>, nextIndexMap: QueueIndexByKey) => {
        'worklet';
        sharedIndexMap.value = nextIndexMap;
      })(dIndexByKey, indexMap);
    },
    [dIndexByKey]
  );

  const setVisibleEntries = useCallback((nextEntries: QueueEntry[]) => {
    entriesRef.current = nextEntries;
    if (dragInFlightRef.current) updateDragIndexMap(indexByEntryKey(nextEntries));
    setEntries(nextEntries);
  }, [updateDragIndexMap]);

  const setOptimisticEntries = useCallback(
    (nextEntries: QueueEntry[]) => {
      setVisibleEntries(nextEntries);
      useQueueStore.getState().replaceUpcoming(nextEntries.map((entry) => entry.track));
    },
    [setVisibleEntries]
  );

  useEffect(() => {
    let cancelled = false;
    let frame: number | null = null;

    frame = requestAnimationFrame(() => {
      if (cancelled) return;
      setEditMode(false);
      setSelectedKeys(new Set());

      setEntries((previous) => {
        const next = hasSnapshot
          ? reconcileQueueEntries(
              upcomingTracks,
              entriesRef.current.length > 0 ? entriesRef.current : previous,
              entrySerial
            )
          : [];
        entriesRef.current = next;
        if (dragInFlightRef.current) updateDragIndexMap(indexByEntryKey(next));
        return next;
      });
    });

    return () => {
      cancelled = true;
      if (frame != null) cancelAnimationFrame(frame);
    };
  }, [hasSnapshot, setVisibleEntries, upcomingTracks, updateDragIndexMap]);

  const visibleSelectedKeys = useMemo(() => {
    if (selectedKeys.size === 0) return EMPTY_KEY_SET;
    const validKeys = new Set(entries.map((entry) => entry.key));
    return new Set([...selectedKeys].filter((key) => validKeys.has(key)));
  }, [entries, selectedKeys]);

  const retrySetUpcoming = useCallback(
    (nextTracks: RntpTrack[]) => {
      useQueueStore.getState().replaceUpcoming(nextTracks);
      void setUpcoming(nextTracks).catch(() => refresh());
    },
    [refresh]
  );

  const commitNativeMove = useCallback(
    (fromAbsolute: number, toAbsolute: number, nextTracks: RntpTrack[]) => {
      void moveQueueItem(fromAbsolute, toAbsolute).catch(() => {
        retrySetUpcoming(nextTracks);
      });
    },
    [retrySetUpcoming]
  );

  const finishDrag = useCallback(
    (from: number, to: number) => {
      const snapshot = entriesRef.current;
      if (from === to || from < 0 || to < 0 || from >= snapshot.length || to >= snapshot.length) {
        return;
      }

      const nextEntries = arrayMove(snapshot, from, to);
      setVisibleEntries(nextEntries);
      clearDragAfterReorderCommit();
      commitNativeMove(
        baseOffset + from,
        baseOffset + to,
        nextEntries.map((entry) => entry.track)
      );
    },
    [baseOffset, clearDragAfterReorderCommit, commitNativeMove, setVisibleEntries]
  );

  const onDragArm = useCallback(() => {
    dragInFlightRef.current = true;
    dragArmHaptic();
  }, []);

  const onDragAbort = useCallback(() => {
    dragInFlightRef.current = false;
  }, []);

  const makeDragGesture = useCallback(
    (
      localIndex: number,
      longPress: boolean,
      entryKey: string,
      entryCount: number
    ): GestureType => {
      const gesture = Gesture.Pan()
        .onStart(() => {
          const currentIndex = dIndexByKey.value[entryKey] ?? localIndex;
          dStart.value = currentIndex;
          dTarget.value = currentIndex;
          dTy.value = 0;
          dKey.value = entryKey;
          dSettling.value = false;
          dActive.value = true;
          runOnJS(onDragArm)();
        })
        .onUpdate((event) => {
          dTy.value = event.translationY;
          const nextTarget = clampLocal(
            Math.round(dStart.value + event.translationY / QUEUE_ROW_HEIGHT),
            entryCount
          );
          if (nextTarget !== dTarget.value) {
            dTarget.value = nextTarget;
            runOnJS(tickHaptic)();
          }
        })
        .onEnd(() => {
          const from = dStart.value;
          const to = dTarget.value;
          if (from === to || from < 0 || to < 0) {
            dTy.value = withTiming(0, motion.quick, (finished) => {
              if (!finished) return;
              dActive.value = false;
              dTy.value = 0;
              dStart.value = -1;
              dTarget.value = -1;
              dSettling.value = false;
              dKey.value = '';
              dIndexByKey.value = {};
              runOnJS(onDragAbort)();
            });
            return;
          }

          dTy.value = withTiming((to - from) * QUEUE_ROW_HEIGHT, motion.quick, (finished) => {
            if (!finished) return;
            dSettling.value = true;
            runOnJS(finishDrag)(from, to);
          });
        });

      return longPress ? gesture.activateAfterLongPress(250) : gesture;
    },
    [dActive, dIndexByKey, dKey, dSettling, dStart, dTarget, dTy, finishDrag, onDragAbort, onDragArm]
  );

  const runAndRefresh = useCallback(
    (task: Promise<void>) => {
      void task.catch(() => refresh());
    },
    [refresh]
  );

  const jump = useCallback(
    (localIndex: number) => {
      runAndRefresh(jumpToQueueIndex(baseOffset + localIndex));
    },
    [baseOffset, runAndRefresh]
  );

  const playNext = useCallback(
    (localIndex: number) => {
      const nextEntries = arrayMove(entriesRef.current, localIndex, 0);
      setOptimisticEntries(nextEntries);
      runAndRefresh(requeueToTop(baseOffset + localIndex));
    },
    [baseOffset, runAndRefresh, setOptimisticEntries]
  );

  const remove = useCallback(
    (localIndex: number) => {
      const action = removeQueueEntryAt(entriesRef.current, localIndex, baseOffset);
      if (!action) return;

      setOptimisticEntries(action.nextEntries);
      runAndRefresh(removeFromQueue(action.absoluteIndex, { updateMirror: false }));
    },
    [baseOffset, runAndRefresh, setOptimisticEntries]
  );

  const toggleSelect = useCallback((key: string) => {
    setSelectedKeys((previous) => {
      const next = new Set(previous);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const exitEdit = useCallback(() => {
    setEditMode(false);
    setSelectedKeys(new Set());
  }, []);

  const groupPlayNext = useCallback(() => {
    const action = resolveSelectedQueueAction(entriesRef.current, visibleSelectedKeys, baseOffset);
    if (action.absoluteIndices.length === 0) {
      exitEdit();
      return;
    }

    setOptimisticEntries(action.entriesWithSelectedFirst);
    runAndRefresh(requeueManyToTop(action.absoluteIndices));
    exitEdit();
  }, [baseOffset, exitEdit, runAndRefresh, setOptimisticEntries, visibleSelectedKeys]);

  const groupRemove = useCallback(() => {
    const action = resolveSelectedQueueAction(entriesRef.current, visibleSelectedKeys, baseOffset);
    if (action.absoluteIndices.length === 0) {
      exitEdit();
      return;
    }

    setOptimisticEntries(action.entriesWithoutSelected);
    runAndRefresh(removeManyFromQueue(action.absoluteIndices, { updateMirror: false }));
    exitEdit();
  }, [baseOffset, exitEdit, runAndRefresh, setOptimisticEntries, visibleSelectedKeys]);

  const renderBackdrop = useCallback(
    (props: BottomSheetBackdropProps) => (
      <BottomSheetBackdrop
        {...props}
        appearsOnIndex={0}
        disappearsOnIndex={-1}
        pressBehavior="close"
        opacity={0.58}
      />
    ),
    []
  );

  const queueReady = hasSnapshot;
  const isLoadingQueue = !queueReady;

  const listExtraData = useMemo(
    () => ({ editMode, selectedKeys: visibleSelectedKeys, queueReady }),
    [editMode, queueReady, visibleSelectedKeys]
  );

  const renderItem = useCallback(
    ({ item, index }: ListRenderItemInfo<QueueEntry>) => (
      <QueueRow
        entry={item}
        entryCount={entries.length}
        localIndex={index}
        actionsEnabled={queueReady}
        editMode={editMode}
        selected={visibleSelectedKeys.has(item.key)}
        makeDragGesture={makeDragGesture}
        dStart={dStart}
        dTarget={dTarget}
        dTy={dTy}
        dActive={dActive}
        dKey={dKey}
        dSettling={dSettling}
        dIndexByKey={dIndexByKey}
        onJumpIndex={jump}
        onPlayNextIndex={playNext}
        onRemoveIndex={remove}
        onToggleSelectKey={toggleSelect}
      />
    ),
    [
      dActive,
      dIndexByKey,
      dKey,
      dSettling,
      dStart,
      dTarget,
      dTy,
      editMode,
      entries.length,
      jump,
      makeDragGesture,
      playNext,
      queueReady,
      remove,
      toggleSelect,
      visibleSelectedKeys,
    ]
  );

  const renderEmpty = useMemo(
    () => (
      <View style={styles.empty}>
        {isLoadingQueue ? (
          <>
            <Ionicons name="list-outline" size={28} color={colors.textTertiary} />
            <Text variant="body" style={styles.emptyTitle}>
              Preparing queue...
            </Text>
          </>
        ) : (
          <>
            <Ionicons name="musical-notes-outline" size={28} color={colors.textTertiary} />
            <Text variant="body" style={styles.emptyTitle}>
              Nothing queued
            </Text>
            <Text variant="label" style={styles.emptyCopy}>
              Add a song or album to keep the music going.
            </Text>
          </>
        )}
      </View>
    ),
    [isLoadingQueue, colors, styles]
  );

  const selectedCount = visibleSelectedKeys.size;
  const canEdit = queueReady && entries.length > 0;

  return (
    <BottomSheet
      index={0}
      snapPoints={snapPoints}
      enableDynamicSizing={false}
      enablePanDownToClose
      enableContentPanningGesture={!editMode}
      enableHandlePanningGesture
      onClose={onClose}
      backdropComponent={renderBackdrop}
      backgroundStyle={styles.sheetBg}
      handleIndicatorStyle={styles.handle}
    >
      <View style={styles.headerRow}>
        <View style={styles.headerText}>
          <Text variant="heading" style={styles.headerTitle}>
            Queue
          </Text>
          <Text variant="label" numberOfLines={1} style={styles.headerCount}>
            {queueCountLabel(upcomingTotal)}
          </Text>
        </View>
        {canEdit ? (
          <Pressable
            hitSlop={10}
            onPress={() => (editMode ? exitEdit() : setEditMode(true))}
            accessibilityRole="button"
            accessibilityLabel={editMode ? 'Cancel queue editing' : 'Edit queue'}
          >
            <Text variant="label" style={styles.editBtn}>
              {editMode ? 'Cancel' : 'Edit'}
            </Text>
          </Pressable>
        ) : null}
      </View>

      {currentTrack ? (
        <View style={styles.nowPlaying}>
          <Text variant="caption" style={styles.sectionLabel}>
            Playing now
          </Text>
          <View style={styles.nowPlayingCard}>
            <Artwork uri={artworkUri(currentTrack)} title={trackTitle(currentTrack)} />
            <View style={styles.meta}>
              <Text variant="body" numberOfLines={1} style={styles.titleActive}>
                {trackTitle(currentTrack)}
              </Text>
              <Text variant="label" numberOfLines={1} style={styles.artistActive}>
                {trackArtist(currentTrack)}
              </Text>
            </View>
            <Ionicons name="volume-high" size={18} color={colors.accent} />
          </View>
        </View>
      ) : null}

      <Text variant="caption" style={[styles.sectionLabel, styles.upcomingLabel]}>
        Up next
      </Text>

      <FlashList
        data={entries}
        scrollEnabled={!editMode}
        style={listClampStyle}
        keyExtractor={(item) => item.key}
        drawDistance={QUEUE_ROW_HEIGHT * 12}
        maintainVisibleContentPosition={{ disabled: true }}
        renderScrollComponent={renderFlashListScrollComponent}
        renderItem={renderItem}
        extraData={listExtraData}
        contentContainerStyle={[
          styles.listContent,
          editMode && selectedCount > 0 ? styles.listContentWithActionBar : null,
        ]}
        showsVerticalScrollIndicator={false}
        ListEmptyComponent={renderEmpty}
      />

      {editMode && selectedCount > 0 ? (
        <View style={[styles.actionBar, { paddingBottom: insets.bottom + spacing.sm }]}>
          <Pressable
            style={({ pressed }) => [styles.actionBtn, pressed && styles.actionBtnPressed]}
            onPress={groupPlayNext}
            accessibilityRole="button"
            accessibilityLabel={`Play ${selectedCount} selected songs next`}
          >
            <Ionicons name="play-skip-forward" size={18} color={colors.accent} />
            <Text variant="label" style={styles.actionText}>
              Play next ({selectedCount})
            </Text>
          </Pressable>
          <Pressable
            style={({ pressed }) => [styles.actionBtn, pressed && styles.actionBtnPressed]}
            onPress={groupRemove}
            accessibilityRole="button"
            accessibilityLabel={`Remove ${selectedCount} selected songs from queue`}
          >
            <Ionicons name="trash-outline" size={18} color={colors.warning} />
            <Text variant="label" style={[styles.actionText, styles.actionTextDestructive]}>
              Remove ({selectedCount})
            </Text>
          </Pressable>
        </View>
      ) : null}
    </BottomSheet>
  );
}

const Artwork = memo(function Artwork({ uri, title }: { uri?: string; title?: string }) {
  const styles = useStyles();
  return (
    <View style={styles.art}>
      {uri ? (
        <Image
          source={{ uri }}
          style={styles.artImage}
          contentFit="cover"
          cachePolicy="memory-disk"
          recyclingKey={uri}
          transition={null}
          allowDownscaling
          accessibilityLabel={title ? `${title} artwork` : undefined}
        />
      ) : (
        <AstraLogo size={16} />
      )}
    </View>
  );
});

interface QueueRowProps {
  entry: QueueEntry;
  entryCount: number;
  localIndex: number;
  actionsEnabled: boolean;
  editMode: boolean;
  selected: boolean;
  makeDragGesture: (
    localIndex: number,
    longPress: boolean,
    entryKey: string,
    entryCount: number
  ) => GestureType;
  dStart: SharedValue<number>;
  dTarget: SharedValue<number>;
  dTy: SharedValue<number>;
  dActive: SharedValue<boolean>;
  dKey: SharedValue<string>;
  dSettling: SharedValue<boolean>;
  dIndexByKey: SharedValue<QueueIndexByKey>;
  onJumpIndex: (localIndex: number) => void;
  onPlayNextIndex: (localIndex: number) => void;
  onRemoveIndex: (localIndex: number) => void;
  onToggleSelectKey: (key: string) => void;
}

const QueueRow = memo(function QueueRow({
  entry,
  entryCount,
  localIndex,
  actionsEnabled,
  editMode,
  selected,
  makeDragGesture,
  dStart,
  dTarget,
  dTy,
  dActive,
  dKey,
  dSettling,
  dIndexByKey,
  onJumpIndex,
  onPlayNextIndex,
  onRemoveIndex,
  onToggleSelectKey,
}: QueueRowProps) {
  const styles = useStyles();
  const colors = useColors();
  const entryKey = entry.key;
  const title = trackTitle(entry.track);
  const artist = trackArtist(entry.track);

  const gesture = useMemo(
    () => makeDragGesture(localIndex, !editMode, entryKey, entryCount),
    [editMode, entryCount, entryKey, localIndex, makeDragGesture]
  );

  const onJump = useCallback(() => onJumpIndex(localIndex), [localIndex, onJumpIndex]);
  const onPlayNext = useCallback(
    () => onPlayNextIndex(localIndex),
    [localIndex, onPlayNextIndex]
  );
  const onRemove = useCallback(() => onRemoveIndex(localIndex), [localIndex, onRemoveIndex]);
  const onToggleSelect = useCallback(
    () => onToggleSelectKey(entryKey),
    [entryKey, onToggleSelectKey]
  );

  const rowMotionStyle = useAnimatedStyle(() => {
    if (!dActive.value) {
      return {
        transform: [
          { translateY: withTiming(0, motion.quick) },
          { scale: withTiming(1, motion.quick) },
        ],
        zIndex: 0,
        elevation: 0,
        shadowOpacity: withTiming(0, motion.quick),
      };
    }

    if (dKey.value === entryKey) {
      const currentIndex = dIndexByKey.value[entryKey] ?? localIndex;
      const baseIndexDelta = (currentIndex - dStart.value) * QUEUE_ROW_HEIGHT;
      return {
        transform: [
          { translateY: dTy.value - baseIndexDelta },
          { scale: withTiming(dSettling.value ? 1 : 1.025, motion.quick) },
        ],
        zIndex: 30,
        elevation: 8,
        shadowOpacity: withTiming(dSettling.value ? 0 : 0.22, motion.quick),
      };
    }

    const currentIndex = dIndexByKey.value[entryKey] ?? localIndex;
    if (dSettling.value) {
      return {
        transform: [
          { translateY: withTiming(0, motion.quick) },
          { scale: withTiming(1, motion.quick) },
        ],
        zIndex: 0,
        elevation: 0,
        shadowOpacity: withTiming(0, motion.quick),
      };
    }

    const start = dStart.value;
    const target = dTarget.value;
    let shift = 0;
    if (start < target && currentIndex > start && currentIndex <= target) {
      shift = -QUEUE_ROW_HEIGHT;
    } else if (start > target && currentIndex >= target && currentIndex < start) {
      shift = QUEUE_ROW_HEIGHT;
    }

    return {
      transform: [
        { translateY: withTiming(shift, motion.quick) },
        { scale: withTiming(1, motion.quick) },
      ],
      zIndex: 0,
      elevation: 0,
      shadowOpacity: withTiming(0, motion.quick),
    };
  });

  // Locals so the worklet captures plain strings: a theme switch re-renders,
  // the captured values change, and Reanimated rebuilds the worklet.
  const dragSurface = colors.bgTertiary;
  const selectedSurface = colors.glassHighlight;
  const restSurface = colors.bgSecondary;
  const rowSurfaceStyle = useAnimatedStyle(() => ({
    backgroundColor:
      dActive.value && dKey.value === entryKey
        ? dragSurface
        : selected
          ? selectedSurface
          : restSurface,
  }));

  const rowContent = (
    <Animated.View style={[styles.row, rowSurfaceStyle]}>
      {editMode ? (
        <Pressable
          hitSlop={8}
          onPress={onToggleSelect}
          style={styles.checkbox}
          accessibilityRole="checkbox"
          accessibilityState={{ checked: selected }}
          accessibilityLabel={`${selected ? 'Deselect' : 'Select'} ${title}`}
        >
          <Ionicons
            name={selected ? 'checkmark-circle' : 'ellipse-outline'}
            size={22}
            color={selected ? colors.accent : colors.textTertiary}
          />
        </Pressable>
      ) : null}
      <Artwork uri={artworkUri(entry.track)} title={title} />
      <View style={styles.meta}>
        <Text variant="body" numberOfLines={1} style={styles.title}>
          {title}
        </Text>
        <Text variant="label" numberOfLines={1}>
          {artist}
        </Text>
      </View>
      {editMode ? (
        <GestureDetector gesture={gesture}>
          <View
            style={styles.dragHandle}
            accessible
            accessibilityLabel={`Reorder ${title}`}
          >
            <Ionicons name="reorder-three" size={24} color={colors.textTertiary} />
          </View>
        </GestureDetector>
      ) : null}
    </Animated.View>
  );

  if (!actionsEnabled) {
    return (
      <Animated.View style={[styles.rowOuter, rowMotionStyle]}>
        <Pressable
          onPress={onJump}
          style={({ pressed }) => [styles.rowPressable, pressed && styles.rowPressed]}
          accessibilityRole="button"
          accessibilityLabel={`Play ${title}`}
          accessibilityHint="Opens this song in the queue"
        >
          {rowContent}
        </Pressable>
      </Animated.View>
    );
  }

  if (editMode) {
    return (
      <Animated.View style={[styles.rowOuter, rowMotionStyle]}>
        <Pressable
          onPress={onToggleSelect}
          style={({ pressed }) => [styles.rowPressable, pressed && styles.rowPressed]}
          accessibilityRole="button"
          accessibilityState={{ selected }}
          accessibilityLabel={`${selected ? 'Deselect' : 'Select'} ${title}`}
        >
          {rowContent}
        </Pressable>
      </Animated.View>
    );
  }

  return (
    <Animated.View style={[styles.rowOuter, rowMotionStyle]}>
      <SwipeableRow
        dragGesture={gesture}
        swipeRight={{ icon: 'play-skip-forward', color: colors.accent, onCommit: onPlayNext }}
        swipeLeft={{ icon: 'trash', color: colors.warning, onCommit: onRemove }}
      >
        <Pressable
          onPress={onJump}
          style={({ pressed }) => [styles.rowPressable, pressed && styles.rowPressed]}
          accessibilityRole="button"
          accessibilityLabel={`Play ${title}`}
          accessibilityHint="Opens this song in the queue"
        >
          {rowContent}
        </Pressable>
      </SwipeableRow>
    </Animated.View>
  );
});

const useStyles = createThemedStyles((colors) => ({
  sheetBg: {
    backgroundColor: colors.bgSecondary,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
  },
  handle: {
    backgroundColor: colors.glassBorder,
    width: 38,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
  },
  headerText: {
    flex: 1,
    minWidth: 0,
  },
  headerTitle: {
    fontSize: 20,
  },
  headerCount: {
    color: colors.textTertiary,
    marginTop: 2,
  },
  editBtn: {
    color: colors.accent,
  },
  sectionLabel: {
    color: colors.textTertiary,
    fontSize: 11,
    letterSpacing: 0,
    paddingHorizontal: spacing.lg,
  },
  upcomingLabel: {
    marginTop: spacing.md,
    marginBottom: spacing.xs,
  },
  nowPlaying: {
    paddingBottom: spacing.xs,
  },
  nowPlayingCard: {
    height: QUEUE_ROW_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginHorizontal: spacing.lg,
    marginTop: spacing.xs,
    paddingHorizontal: spacing.md,
    borderRadius: radius.sm,
    borderColor: colors.glassBorder,
    borderWidth: StyleSheet.hairlineWidth,
    backgroundColor: colors.glassBg,
  },
  listContent: {
    paddingBottom: spacing.xxl,
    flexGrow: 1,
  },
  listContentWithActionBar: {
    paddingBottom: spacing.xxl * 2,
  },
  empty: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.xxl,
  },
  emptyTitle: {
    marginTop: spacing.md,
    textAlign: 'center',
  },
  emptyCopy: {
    marginTop: spacing.xs,
    textAlign: 'center',
    color: colors.textTertiary,
  },
  rowOuter: {
    height: QUEUE_ROW_HEIGHT,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowRadius: 18,
  },
  rowPressable: {
    height: QUEUE_ROW_HEIGHT,
  },
  rowPressed: {
    opacity: 0.72,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    height: QUEUE_ROW_HEIGHT,
    paddingHorizontal: spacing.lg,
    borderBottomColor: colors.glassBorder,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  checkbox: {
    width: 24,
    alignItems: 'center',
  },
  art: {
    width: ART,
    height: ART,
    flexShrink: 0,
    borderRadius: radius.sm,
    backgroundColor: colors.bgTertiary,
    borderColor: colors.glassBorder,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  artImage: {
    width: '100%',
    height: '100%',
  },
  meta: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  title: {
    fontSize: 15,
  },
  titleActive: {
    fontSize: 15,
    color: colors.accentTextStrong,
  },
  artistActive: {
    color: colors.accentText,
  },
  dragHandle: {
    width: 34,
    height: QUEUE_ROW_HEIGHT,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionBar: {
    flexDirection: 'row',
    borderTopColor: colors.glassBorder,
    borderTopWidth: StyleSheet.hairlineWidth,
    backgroundColor: colors.bgTertiary,
  },
  actionBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.md,
  },
  actionBtnPressed: {
    opacity: 0.7,
  },
  actionText: {
    color: colors.accent,
  },
  actionTextDestructive: {
    color: colors.warning,
  },
}));

export default QueueTray;

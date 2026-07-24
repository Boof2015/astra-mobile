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
import { SCROLL_PRESS_DELAY, useRipple } from '@/theme/ripple';
import { motion } from '@/theme/motion';
import { artworkThumbFromSource } from '@/library/artwork';
import { playHaptic } from '@/lib/haptics';
import { useQueueStore } from '@/stores/queueStore';
import {
  getVirtualQueuePage,
  getVirtualQueueState,
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
  indexQueueEntriesByKey,
  moveQueueEntry,
  removeQueueEntryAt,
  resolveSelectedQueueAction,
  type QueueIndexByKey,
} from './queueActions';

const QUEUE_ROW_HEIGHT = 64;
const ART = 42;
const EMPTY_KEY_SET = new Set<string>();

interface QueueEntry {
  key: string;
  identity: string;
  track: RntpTrack;
  absoluteIndex: number;
}

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
  // RNTP tracks carry the full-size cover; 42px rows want the generated thumb.
  if (typeof track.artwork !== 'string') return undefined;
  return artworkThumbFromSource(track.artwork) ?? undefined;
}

function queueCountLabel(count: number): string {
  if (count === 0) return 'No songs next';
  if (count === 1) return '1 song next';
  return `${count} songs next`;
}

function clampLocal(value: number, len: number): number {
  'worklet';
  return Math.max(0, Math.min(len - 1, value));
}

function reconcileQueueEntries(
  tracks: readonly RntpTrack[],
  previous: readonly QueueEntry[],
  nextSerial: { current: number },
  baseOffset: number,
): QueueEntry[] {
  const available = new Map<string, QueueEntry[]>();
  previous.forEach((entry) => {
    const bucket = available.get(entry.identity);
    if (bucket) bucket.push(entry);
    else available.set(entry.identity, [entry]);
  });

  return tracks.map((track, index) => {
    const identity = rntpKey(track);
    const nativePosition = track.astraQueuePosition;
    const absoluteIndex = typeof nativePosition === 'number'
      ? nativePosition
      : baseOffset + index;
    const reused = available.get(identity)?.shift();
    if (reused) {
      // Same track object → same entry object, so memo'd rows bail out when
      // only other parts of the queue changed (e.g. a track advance).
      if (reused.track === track && reused.absoluteIndex === absoluteIndex) return reused;
      return { ...reused, track, identity, absoluteIndex };
    }

    const key = `${identity}:${nextSerial.current}`;
    nextSerial.current += 1;
    return { key, identity, track, absoluteIndex };
  });
}

interface QueueTrayProps {
  onClose: () => void;
  embedded?: boolean;
}

// memo: the parent now-playing screen re-renders on store changes; the tray's
// ~15-hook body shouldn't re-execute unless its own inputs change.
export const QueueTray = memo(function QueueTray({ onClose, embedded = false }: QueueTrayProps) {
  const styles = useStyles();
  const colors = useColors();
  const ripple = useRipple();
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  const snapPoints = useMemo(() => ['58%', '100%'], []);
  const renderFlashListScrollComponent = useBottomSheetScrollableCreator();
  // While the sheet-open animation runs, the bottom-sheet scrollable can
  // momentarily fail to constrain the list, so FlashList measures its viewport
  // as the full CONTENT height (~100k dp for a long queue), believes every row
  // is visible, and mounts thousands of views — a multi-second main-thread
  // freeze. Clamping the list area to the window height caps the viewport no
  // matter what the sheet reports; both snap points stay unaffected. The flex
  // matches FlashList's own root default, so the wrapper reproduces the exact
  // box the list had when the clamp sat on it directly.
  const listAreaStyle = useMemo(
    () => [styles.listArea, { maxHeight: windowHeight }],
    [styles, windowHeight]
  );
  // Same bug, milder symptom: a viewport measured during the open animation can
  // stick at the clamp height (taller than the sheet's real content area), which
  // silently shortens the scroll range — the last few rows become unreachable.
  // Mounting the list only after the sheet settles removes the bad window.
  const [listReady, setListReady] = useState(embedded);
  const onSheetChange = useCallback((index: number) => {
    if (index >= 0) setListReady(true);
  }, []);
  // The gate leaves the list area blank while the sheet opens (plus FlashList's
  // first-layout frame), which reads as content popping in. A static,
  // pixel-identical preview of the first screenful of rows fills the slot from
  // the tray's first frame and unmounts once the real list has painted (onLoad
  // fires a frame after first layout completes, so rows are already underneath).
  const [listPainted, setListPainted] = useState(false);
  const onListLoad = useCallback(() => setListPainted(true), []);
  const previewCount = Math.ceil(windowHeight / QUEUE_ROW_HEIGHT);
  // Bottom padding clears the gesture-nav inset so the last row is fully
  // scrollable into view at the 100% snap.
  const listContentStyle = useMemo(
    () => [styles.listContent, { paddingBottom: spacing.xxl + insets.bottom }],
    [styles, insets.bottom]
  );
  const listContentEditStyle = useMemo(
    () => [styles.listContent, { paddingBottom: spacing.xxl * 2 + insets.bottom }],
    [styles, insets.bottom]
  );

  const { tracks, activeIndex, hasSnapshot, refresh } = useQueue(true);
  const currentTrack = activeIndex >= 0 ? tracks[activeIndex] : undefined;
  const rollingUpcomingTracks = useMemo(
    () => (activeIndex >= 0 ? tracks.slice(activeIndex + 1) : tracks),
    [tracks, activeIndex]
  );
  const virtualState = getVirtualQueueState();
  const virtualMode = virtualState !== null;
  const virtualActivePosition = virtualState?.activePosition ?? -1;
  const [virtualTracks, setVirtualTracks] = useState<RntpTrack[]>([]);
  const virtualTracksRef = useRef<RntpTrack[]>([]);
  const virtualLoadGeneration = useRef(0);
  const virtualLoading = useRef(false);

  const loadVirtualPage = useCallback(async (reset: boolean) => {
    const state = getVirtualQueueState();
    if (!state || (!reset && virtualLoading.current)) return;
    virtualLoading.current = true;
    const generation = reset ? ++virtualLoadGeneration.current : virtualLoadGeneration.current;
    const existing = reset ? [] : virtualTracksRef.current;
    const lastPosition = existing.length > 0
      ? existing[existing.length - 1].astraQueuePosition
      : state.activePosition;
    const start = typeof lastPosition === 'number'
      ? lastPosition + 1
      : state.activePosition + 1;
    try {
      const page = await getVirtualQueuePage(start, 100);
      if (
        !page ||
        generation !== virtualLoadGeneration.current ||
        getVirtualQueueState()?.sessionId !== state.sessionId
      ) return;
      const next = reset ? page.items.map((item) => item.track) : [
        ...existing,
        ...page.items.map((item) => item.track),
      ];
      // Keep no more than five tray pages in JS.
      const bounded = next.slice(-500);
      virtualTracksRef.current = bounded;
      setVirtualTracks(bounded);
    } finally {
      if (generation === virtualLoadGeneration.current) virtualLoading.current = false;
    }
  }, []);

  useEffect(() => {
    if (!virtualMode) {
      virtualLoadGeneration.current += 1;
      virtualTracksRef.current = [];
      setVirtualTracks([]);
      return;
    }
    void loadVirtualPage(true);
  }, [loadVirtualPage, virtualActivePosition, virtualMode, virtualState?.sessionId]);

  const upcomingTracks = virtualMode ? virtualTracks : rollingUpcomingTracks;
  const upcomingTotal = virtualState
    ? Math.max(0, virtualState.totalCount - virtualState.activePosition - 1)
    : activeIndex >= 0
      ? Math.max(0, tracks.length - activeIndex - 1)
      : tracks.length;
  const firstVirtualPosition = virtualTracks[0]?.astraQueuePosition;
  const baseOffset = virtualState
    ? typeof firstVirtualPosition === 'number'
      ? firstVirtualPosition
      : virtualState.activePosition + 1
    : activeIndex >= 0
      ? activeIndex + 1
      : 0;
  // Row callbacks resolve indices at call time from refs so their identities
  // survive track advances — an index captured at render time would go stale.
  const baseOffsetRef = useRef(baseOffset);
  useEffect(() => {
    baseOffsetRef.current = baseOffset;
  }, [baseOffset]);

  // Built synchronously so a warm mirror paints on the list's first frame; the
  // update effect below takes over from there.
  const [entries, setEntries] = useState<QueueEntry[]>(() =>
    hasSnapshot ? reconcileQueueEntries(upcomingTracks, [], { current: 0 }, baseOffset) : []
  );
  const entrySerial = useRef(entries.length);
  const entriesRef = useRef<QueueEntry[]>(entries);
  const [editMode, setEditMode] = useState(false);
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());

  const dStart = useSharedValue(-1);
  const dTarget = useSharedValue(-1);
  const dTy = useSharedValue(0);
  const dActive = useSharedValue(false);
  const dKey = useSharedValue('');
  const dSettling = useSharedValue(false);
  const dIndexByKey = useSharedValue<QueueIndexByKey>({});
  // Entry count for the drag clamp, set at drag-arm — capturing it in the
  // gesture closure instead forced a gesture rebuild on every queue change.
  const dCount = useSharedValue(0);
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
        indexMap: SharedValue<QueueIndexByKey>,
        count: SharedValue<number>
      ) => {
        'worklet';
        active.value = false;
        settling.value = false;
        ty.value = 0;
        start.value = -1;
        target.value = -1;
        key.value = '';
        indexMap.value = {};
        count.value = 0;
      }
    )(dActive, dTy, dStart, dTarget, dKey, dSettling, dIndexByKey, dCount);
  }, [dActive, dCount, dIndexByKey, dKey, dSettling, dStart, dTarget, dTy]);

  const clearDragAfterReorderCommit = useCallback(() => {
    requestAnimationFrame(() => {
      requestAnimationFrame(clearDragState);
    });
  }, [clearDragState]);

  const updateDragIndexMap = useCallback(
    (indexMap: QueueIndexByKey, count: number) => {
      runOnUI(
        (
          sharedIndexMap: SharedValue<QueueIndexByKey>,
          sharedCount: SharedValue<number>,
          nextIndexMap: QueueIndexByKey,
          nextCount: number
        ) => {
          'worklet';
          sharedIndexMap.value = nextIndexMap;
          sharedCount.value = nextCount;
        }
      )(dIndexByKey, dCount, indexMap, count);
    },
    [dCount, dIndexByKey]
  );

  const setVisibleEntries = useCallback((nextEntries: QueueEntry[]) => {
    entriesRef.current = nextEntries;
    if (dragInFlightRef.current) {
      updateDragIndexMap(indexQueueEntriesByKey(nextEntries), nextEntries.length);
    }
    setEntries(nextEntries);
  }, [updateDragIndexMap]);

  const setOptimisticEntries = useCallback(
    (nextEntries: QueueEntry[]) => {
      setVisibleEntries(nextEntries);
      if (!virtualMode) {
        useQueueStore.getState().replaceUpcoming(nextEntries.map((entry) => entry.track));
      }
    },
    [setVisibleEntries, virtualMode]
  );

  useEffect(() => {
    setEntries((previous) => {
      const next = hasSnapshot
        ? reconcileQueueEntries(
            upcomingTracks,
            entriesRef.current.length > 0 ? entriesRef.current : previous,
            entrySerial,
            baseOffset,
          )
        : [];
      // The mount-time reconcile of the synchronous initial state is a no-op;
      // bail so it doesn't cost a render.
      const unchanged =
        next.length === previous.length &&
        next.every((entry, index) => entry === previous[index]);
      const resolved = unchanged ? previous : next;
      entriesRef.current = resolved;
      if (dragInFlightRef.current) {
        updateDragIndexMap(indexQueueEntriesByKey(resolved), resolved.length);
      }
      return resolved;
    });
  }, [baseOffset, hasSnapshot, upcomingTracks, updateDragIndexMap]);

  const visibleSelectedKeys = useMemo(() => {
    if (selectedKeys.size === 0) return EMPTY_KEY_SET;
    const validKeys = new Set(entries.map((entry) => entry.key));
    return new Set([...selectedKeys].filter((key) => validKeys.has(key)));
  }, [entries, selectedKeys]);

  const retrySetUpcoming = useCallback(
    (nextTracks: RntpTrack[]) => {
      if (virtualMode) {
        void loadVirtualPage(true);
        return;
      }
      useQueueStore.getState().replaceUpcoming(nextTracks);
      void setUpcoming(nextTracks).catch(() => refresh());
    },
    [loadVirtualPage, refresh, virtualMode]
  );

  const commitNativeMove = useCallback(
    (fromAbsolute: number, toAbsolute: number, nextTracks: RntpTrack[]) => {
      void moveQueueItem(fromAbsolute, toAbsolute, { virtualPosition: virtualMode })
        .then(() => {
          if (virtualMode) void loadVirtualPage(true);
        })
        .catch(() => {
          retrySetUpcoming(nextTracks);
        });
    },
    [loadVirtualPage, retrySetUpcoming, virtualMode]
  );

  const finishDrag = useCallback(
    (from: number, to: number) => {
      const snapshot = entriesRef.current;
      if (from === to || from < 0 || to < 0 || from >= snapshot.length || to >= snapshot.length) {
        clearDragState();
        return;
      }

      const positions = snapshot.map((entry) => entry.absoluteIndex);
      const nextEntries = moveQueueEntry(snapshot, from, to).map((entry, index) => (
        entry.absoluteIndex === positions[index]
          ? entry
          : { ...entry, absoluteIndex: positions[index] }
      ));
      playHaptic('queueDrop');
      setVisibleEntries(nextEntries);
      clearDragAfterReorderCommit();
      commitNativeMove(
        snapshot[from].absoluteIndex,
        snapshot[to].absoluteIndex,
        nextEntries.map((entry) => entry.track)
      );
    },
    [clearDragAfterReorderCommit, clearDragState, commitNativeMove, setVisibleEntries]
  );

  const onDragArm = useCallback(
    (entryKey: string) => {
      dragInFlightRef.current = true;
      const snapshot = entriesRef.current;
      const indexMap = indexQueueEntriesByKey(snapshot);
      const currentIndex = indexMap[entryKey] ?? -1;

      runOnUI(
        (
          active: SharedValue<boolean>,
          key: SharedValue<string>,
          start: SharedValue<number>,
          target: SharedValue<number>,
          sharedIndexMap: SharedValue<QueueIndexByKey>,
          sharedCount: SharedValue<number>,
          armedKey: string,
          armedIndex: number,
          nextIndexMap: QueueIndexByKey,
          armedCount: number
        ) => {
          'worklet';
          if (!active.value || key.value !== armedKey) return;
          sharedIndexMap.value = nextIndexMap;
          sharedCount.value = armedCount;
          start.value = armedIndex;
          target.value = armedIndex;
        }
      )(
        dActive,
        dKey,
        dStart,
        dTarget,
        dIndexByKey,
        dCount,
        entryKey,
        currentIndex,
        indexMap,
        snapshot.length
      );
      playHaptic('queueLift');
    },
    [dActive, dCount, dIndexByKey, dKey, dStart, dTarget]
  );

  const onDragAbort = useCallback(() => {
    dragInFlightRef.current = false;
  }, []);

  // Depends only on the entry key: entry count and indices are resolved at
  // drag time through shared values / refs, so row gestures survive every
  // queue mutation and rebuild only when FlashList recycles a row.
  const makeDragGesture = useCallback(
    (entryKey: string): GestureType =>
      Gesture.Pan()
        // Vertical-only so a horizontal swipe starting on the handle still
        // falls through to the row's SwipeableRow pan.
        .activeOffsetY([-2, 2])
        .failOffsetX([-14, 14])
        .onStart(() => {
          dStart.value = -1;
          dTarget.value = -1;
          dTy.value = 0;
          dKey.value = entryKey;
          dSettling.value = false;
          dActive.value = true;
          runOnJS(onDragArm)(entryKey);
        })
        .onUpdate((event) => {
          dTy.value = event.translationY;
          if (dStart.value < 0) return;
          const nextTarget = clampLocal(
            Math.round(dStart.value + event.translationY / QUEUE_ROW_HEIGHT),
            dCount.value
          );
          if (nextTarget !== dTarget.value) {
            dTarget.value = nextTarget;
            runOnJS(playHaptic)('frequentStep');
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
        })
        .onFinalize((_event, success) => {
          if (success || dKey.value !== entryKey) return;
          dActive.value = false;
          dTy.value = 0;
          dStart.value = -1;
          dTarget.value = -1;
          dSettling.value = false;
          dKey.value = '';
          dIndexByKey.value = {};
          runOnJS(onDragAbort)();
        }),
    [
      dActive,
      dCount,
      dIndexByKey,
      dKey,
      dSettling,
      dStart,
      dTarget,
      dTy,
      finishDrag,
      onDragAbort,
      onDragArm,
    ]
  );

  const runAndRefresh = useCallback(
    (task: Promise<void>) => {
      void task.then(
        () => {
          if (virtualMode) void loadVirtualPage(true);
        },
        () => {
          if (virtualMode) void loadVirtualPage(true);
          else void refresh();
        },
      );
    },
    [loadVirtualPage, refresh, virtualMode]
  );

  const jump = useCallback(
    (key: string) => {
      const localIndex = entriesRef.current.findIndex((entry) => entry.key === key);
      if (localIndex < 0) return;
      const entry = entriesRef.current[localIndex];
      runAndRefresh(jumpToQueueIndex(entry.absoluteIndex, { virtualPosition: virtualMode }));
    },
    [runAndRefresh, virtualMode]
  );

  const playNext = useCallback(
    (key: string) => {
      const localIndex = entriesRef.current.findIndex((entry) => entry.key === key);
      if (localIndex < 0) return;
      const nextEntries = moveQueueEntry(entriesRef.current, localIndex, 0);
      setOptimisticEntries(nextEntries);
      runAndRefresh(requeueToTop(entriesRef.current[localIndex].absoluteIndex, {
        virtualPosition: virtualMode,
      }));
    },
    [runAndRefresh, setOptimisticEntries, virtualMode]
  );

  const remove = useCallback(
    (key: string) => {
      const localIndex = entriesRef.current.findIndex((entry) => entry.key === key);
      if (localIndex < 0) return;
      const action = removeQueueEntryAt(entriesRef.current, localIndex, baseOffsetRef.current);
      if (!action) return;

      setOptimisticEntries(action.nextEntries);
      runAndRefresh(removeFromQueue(
        entriesRef.current[localIndex].absoluteIndex,
        { updateMirror: false, virtualPosition: virtualMode },
      ));
    },
    [runAndRefresh, setOptimisticEntries, virtualMode]
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

  const clearSelection = useCallback(() => {
    setSelectedKeys(new Set());
  }, []);

  useEffect(() => {
    if (editMode && hasSnapshot && entries.length === 0) exitEdit();
  }, [editMode, entries.length, exitEdit, hasSnapshot]);

  const groupPlayNext = useCallback(() => {
    const action = resolveSelectedQueueAction(entriesRef.current, visibleSelectedKeys, baseOffset);
    const absoluteIndices = entriesRef.current
      .filter((entry) => visibleSelectedKeys.has(entry.key))
      .map((entry) => entry.absoluteIndex);
    if (absoluteIndices.length === 0) {
      clearSelection();
      return;
    }

    setOptimisticEntries(action.entriesWithSelectedFirst);
    runAndRefresh(requeueManyToTop(absoluteIndices, { virtualPosition: virtualMode }));
    clearSelection();
  }, [
    baseOffset,
    clearSelection,
    runAndRefresh,
    setOptimisticEntries,
    virtualMode,
    visibleSelectedKeys,
  ]);

  const groupRemove = useCallback(() => {
    const action = resolveSelectedQueueAction(entriesRef.current, visibleSelectedKeys, baseOffset);
    const absoluteIndices = entriesRef.current
      .filter((entry) => visibleSelectedKeys.has(entry.key))
      .map((entry) => entry.absoluteIndex);
    if (absoluteIndices.length === 0) {
      clearSelection();
      return;
    }

    setOptimisticEntries(action.entriesWithoutSelected);
    runAndRefresh(removeManyFromQueue(absoluteIndices, {
      updateMirror: false,
      virtualPosition: virtualMode,
    }));
    clearSelection();
  }, [
    baseOffset,
    clearSelection,
    runAndRefresh,
    setOptimisticEntries,
    virtualMode,
    visibleSelectedKeys,
  ]);

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
    ({ item }: ListRenderItemInfo<QueueEntry>) => (
      <QueueRow
        entry={item}
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
        onJumpKey={jump}
        onPlayNextKey={playNext}
        onRemoveKey={remove}
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

  const body = (
    <>
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
          <Pressable android_ripple={ripple.bounded}
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

      <View style={listAreaStyle}>
        {listReady ? (
          <FlashList
            data={entries}
            scrollEnabled
            keyExtractor={(item) => item.key}
            drawDistance={QUEUE_ROW_HEIGHT * 12}
            maintainVisibleContentPosition={{ disabled: true }}
            renderScrollComponent={embedded ? undefined : renderFlashListScrollComponent}
            renderItem={renderItem}
            extraData={listExtraData}
            onLoad={onListLoad}
            onEndReached={virtualMode ? () => void loadVirtualPage(false) : undefined}
            onEndReachedThreshold={0.6}
            contentContainerStyle={embedded
              ? styles.embeddedListContent
              : editMode && selectedCount > 0
                ? listContentEditStyle
                : listContentStyle}
            showsVerticalScrollIndicator={false}
            ListEmptyComponent={renderEmpty}
          />
        ) : null}
        {!listPainted && entries.length > 0 ? (
          <View style={styles.listPreview} pointerEvents="none">
            {entries.slice(0, previewCount).map((entry) => (
              <QueuePreviewRow key={entry.key} entry={entry} />
            ))}
          </View>
        ) : null}
      </View>

      {editMode && selectedCount > 0 ? (
        <View
          style={[
            styles.actionBar,
            { paddingBottom: (embedded ? 0 : insets.bottom) + spacing.sm },
          ]}
        >
          <Pressable
            android_ripple={ripple.bounded}
            style={styles.actionBtn}
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
            android_ripple={ripple.bounded}
            style={styles.actionBtn}
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
    </>
  );

  if (embedded) {
    return <View style={styles.embeddedRoot}>{body}</View>;
  }

  return (
    <BottomSheet
      index={0}
      snapPoints={snapPoints}
      enableDynamicSizing={false}
      enablePanDownToClose
      enableContentPanningGesture={!editMode}
      enableHandlePanningGesture
      onChange={onSheetChange}
      onClose={onClose}
      backdropComponent={renderBackdrop}
      backgroundStyle={styles.sheetBg}
      handleIndicatorStyle={styles.handle}
    >
      {body}
    </BottomSheet>
  );
});

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

// Static stand-in for QueueRow while the real list is gated/painting: identical
// geometry and visuals (idle rows carry no transforms), no worklets, gestures,
// or press feedback — it exists only to be looked at for a few frames.
const QueuePreviewRow = memo(function QueuePreviewRow({ entry }: { entry: QueueEntry }) {
  const styles = useStyles();
  const colors = useColors();
  const title = trackTitle(entry.track);
  return (
    <View style={styles.rowOuter}>
      <View style={[styles.row, styles.rowRest]}>
        <Artwork uri={artworkUri(entry.track)} title={title} />
        <View style={styles.meta}>
          <Text variant="body" numberOfLines={1} style={styles.title}>
            {title}
          </Text>
          <Text variant="label" numberOfLines={1}>
            {trackArtist(entry.track)}
          </Text>
        </View>
        <View style={styles.dragHandle}>
          <Ionicons name="reorder-three" size={24} color={colors.textTertiary} />
        </View>
      </View>
    </View>
  );
});

interface QueueRowProps {
  entry: QueueEntry;
  actionsEnabled: boolean;
  editMode: boolean;
  selected: boolean;
  makeDragGesture: (entryKey: string) => GestureType;
  dStart: SharedValue<number>;
  dTarget: SharedValue<number>;
  dTy: SharedValue<number>;
  dActive: SharedValue<boolean>;
  dKey: SharedValue<string>;
  dSettling: SharedValue<boolean>;
  dIndexByKey: SharedValue<QueueIndexByKey>;
  onJumpKey: (key: string) => void;
  onPlayNextKey: (key: string) => void;
  onRemoveKey: (key: string) => void;
  onToggleSelectKey: (key: string) => void;
}

const QueueRow = memo(function QueueRow({
  entry,
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
  onJumpKey,
  onPlayNextKey,
  onRemoveKey,
  onToggleSelectKey,
}: QueueRowProps) {
  const styles = useStyles();
  const colors = useColors();
  const ripple = useRipple();
  const entryKey = entry.key;
  const title = trackTitle(entry.track);
  const artist = trackArtist(entry.track);

  const gesture = useMemo(() => makeDragGesture(entryKey), [entryKey, makeDragGesture]);

  const onJump = useCallback(() => onJumpKey(entryKey), [entryKey, onJumpKey]);
  const onPlayNext = useCallback(() => onPlayNextKey(entryKey), [entryKey, onPlayNextKey]);
  const onRemove = useCallback(() => onRemoveKey(entryKey), [entryKey, onRemoveKey]);
  const onToggleSelect = useCallback(
    () => onToggleSelectKey(entryKey),
    [entryKey, onToggleSelectKey]
  );

  // Idle rows must stay near-free: the early-exit branch creates no timing
  // animations, so scroll-time evaluations (mount/recycle) cost almost nothing.
  // Row indices come from dIndexByKey, which is only populated while a drag is
  // in flight — the idle branch never needs them.
  const rowMotionStyle = useAnimatedStyle(() => {
    if (!dActive.value || dStart.value < 0) {
      return {
        transform: [{ translateY: 0 }, { scale: 1 }],
        zIndex: 0,
        elevation: 0,
        shadowOpacity: 0,
      };
    }

    const currentIndex = dIndexByKey.value[entryKey] ?? -1;

    if (dKey.value === entryKey) {
      const baseIndexDelta =
        currentIndex < 0 ? 0 : (currentIndex - dStart.value) * QUEUE_ROW_HEIGHT;
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

    if (dSettling.value) {
      return {
        transform: [{ translateY: withTiming(0, motion.quick) }, { scale: 1 }],
        zIndex: 0,
        elevation: 0,
        shadowOpacity: 0,
      };
    }

    const start = dStart.value;
    const target = dTarget.value;
    let shift = 0;
    if (currentIndex >= 0) {
      if (start < target && currentIndex > start && currentIndex <= target) {
        shift = -QUEUE_ROW_HEIGHT;
      } else if (start > target && currentIndex >= target && currentIndex < start) {
        shift = QUEUE_ROW_HEIGHT;
      }
    }

    return {
      transform: [{ translateY: withTiming(shift, motion.quick) }, { scale: 1 }],
      zIndex: 0,
      elevation: 0,
      shadowOpacity: 0,
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
        <Pressable android_ripple={ripple.bounded}
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
      {actionsEnabled ? (
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
          android_ripple={ripple.bounded} unstable_pressDelay={SCROLL_PRESS_DELAY}
          style={styles.rowPressable}
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
          android_ripple={ripple.bounded} unstable_pressDelay={SCROLL_PRESS_DELAY}
          style={styles.rowPressable}
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
        swipeRight={{ icon: 'play-skip-forward', color: colors.accent, onCommit: onPlayNext }}
        swipeLeft={{ icon: 'trash', color: colors.warning, onCommit: onRemove }}
      >
        <Pressable
          onPress={onJump}
          android_ripple={ripple.bounded} unstable_pressDelay={SCROLL_PRESS_DELAY}
          style={styles.rowPressable}
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
  embeddedRoot: {
    flex: 1,
    overflow: 'hidden',
  },
  embeddedListContent: {
    flexGrow: 1,
    paddingBottom: spacing.lg,
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
  listArea: {
    flex: 1,
    overflow: 'hidden',
  },
  listPreview: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  listContent: {
    flexGrow: 1,
  },
  // Matches the idle rowSurfaceStyle background the real rows get from their
  // worklet; the preview has no worklets so it carries the color statically.
  rowRest: {
    backgroundColor: colors.bgSecondary,
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
  actionText: {
    color: colors.accent,
  },
  actionTextDestructive: {
    color: colors.warning,
  },
}));

export default QueueTray;

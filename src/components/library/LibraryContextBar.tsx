/* eslint-disable react-hooks/immutability -- Reanimated shared values are mutable gesture state. */
import { useEffect, useMemo } from 'react';
import {
  Pressable,
  StyleSheet,
  View,
  useWindowDimensions,
  type LayoutChangeEvent,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { Text } from '@/components/Text';
import { useSelectionSlide } from '@/components/selectionSlide';
import { radius, spacing } from '@/theme';
import { motion } from '@/theme/motion';
import { createThemedStyles, useColors } from '@/theme/themed';
import { SCROLL_PRESS_DELAY, useRipple } from '@/theme/ripple';
import { playHaptic } from '@/lib/haptics';
import {
  LIBRARY_CONTEXT_BAR_HEIGHT,
  LIBRARY_CONTEXT_TOP_GAP,
  libraryDockShowsActiveLabel,
  libraryDockSwipeDistance,
  resolveLibraryDockSwipe,
  type LibraryDockSwipeDirection,
} from '@/library/libraryViewPresentation';
import {
  LIBRARY_VIEW_MODES,
  adjacentLibraryViewMode,
  type LibraryViewMode,
} from '@/library/libraryViewMode';

type IconName = keyof typeof Ionicons.glyphMap;

const MODE_ICONS: Record<LibraryViewMode, IconName> = {
  albums: 'albums-outline',
  artists: 'people-outline',
  tracks: 'musical-notes-outline',
  playlists: 'list-outline',
  folders: 'folder-outline',
};

export const LIBRARY_CONTEXT_ACTION_SIZE = 44;

export interface LibraryDockContextAction {
  icon: IconName;
  label: string;
  onPress: () => void;
}

interface SelectionActions {
  count: number;
  onPlayNext: () => void;
  onAddToQueue: () => void;
  onAddToPlaylist: () => void;
  onCancel: () => void;
}

export function LibraryContextBar({
  mode,
  bottomClearance,
  onChangeMode,
  onSearch,
  contextAction,
  selection,
}: {
  mode: LibraryViewMode;
  bottomClearance: number;
  onChangeMode: (mode: LibraryViewMode) => void;
  onSearch: () => void;
  contextAction?: LibraryDockContextAction;
  selection?: SelectionActions;
}) {
  const styles = useStyles();
  const colors = useColors();
  const ripple = useRipple();
  const { width, fontScale } = useWindowDimensions();
  const showActiveLabel = libraryDockShowsActiveLabel(width, fontScale);
  const modeIndex = LIBRARY_VIEW_MODES.findIndex((entry) => entry.key === mode);
  const slide = useSelectionSlide(mode, 'horizontal', showActiveLabel ? 'labelled' : 'icons');
  const dragX = useSharedValue(0);
  const primeProgress = useSharedValue(0);
  const swipePrimed = useSharedValue(false);
  const sectionWidth = useSharedValue(0);
  const pendingSwipeDirection = useSharedValue<LibraryDockSwipeDirection | 0>(0);
  const entranceProgress = useSharedValue(0);
  const accessoryEntranceStyle = useAnimatedStyle(() => ({
    opacity: entranceProgress.value,
    transform: [{ translateY: (1 - entranceProgress.value) * spacing.sm }],
  }));
  const selectionStyle = useAnimatedStyle(() => ({
    opacity: slide.presence.value,
    width: slide.extent.value,
    transform: [
      { translateX: slide.offset.value + dragX.value },
      { scaleX: 1 + primeProgress.value * 0.05 },
    ],
  }));

  useEffect(() => {
    entranceProgress.value = withTiming(1, motion.quick);
  }, [entranceProgress]);

  useEffect(() => {
    // A committed swipe keeps its preview offset through the React state
    // handoff. Resetting it in `onFinalize` made the mark visibly retreat to
    // its old section for a frame before `mode` started the real selection
    // slide. Once the destination has committed, both animations run together:
    // the selection slide covers the remaining distance while this preview
    // contribution blends back to zero.
    dragX.value = withTiming(0, motion.quick);
    primeProgress.value = withTiming(0, motion.quick);
    swipePrimed.value = false;
  }, [dragX, mode, primeProgress, swipePrimed]);

  const commitSwipe = (direction: LibraryDockSwipeDirection) => {
    const next = adjacentLibraryViewMode(mode, direction);
    if (!next) {
      playHaptic('thresholdExit');
      return;
    }
    playHaptic('modeCycle');
    onChangeMode(next);
  };

  const swipeGesture = useMemo(
    () => Gesture.Pan()
      .activeOffsetX([-12, 12])
      .failOffsetY([-12, 12])
      .onBegin(() => {
        'worklet';
        pendingSwipeDirection.value = 0;
        primeProgress.value = 0;
        swipePrimed.value = false;
      })
      .onUpdate((event) => {
        'worklet';
        const threshold = libraryDockSwipeDistance(sectionWidth.value);
        const progress = Math.min(1, Math.abs(event.translationX) / threshold);
        const previewLimit = Math.max(10, Math.min(20, slide.extent.value * 0.28));
        const direction: LibraryDockSwipeDirection = event.translationX < 0 ? 1 : -1;
        // The marker previews its destination, not the finger direction: a
        // leftward content swipe advances the selected mark to the right.
        dragX.value = direction * previewLimit * progress;
        primeProgress.value = progress;

        const canMove = direction === 1
          ? modeIndex < LIBRARY_VIEW_MODES.length - 1
          : modeIndex > 0;
        const nowPrimed = progress >= 1 && canMove;
        if (nowPrimed === swipePrimed.value) return;
        swipePrimed.value = nowPrimed;
        runOnJS(playHaptic)(nowPrimed ? 'threshold' : 'thresholdExit');
      })
      .onEnd((event) => {
        'worklet';
        const direction = resolveLibraryDockSwipe({
          translationX: event.translationX,
          velocityX: event.velocityX,
          width: sectionWidth.value,
        });
        const canMove = direction === 1
          ? modeIndex < LIBRARY_VIEW_MODES.length - 1
          : direction === -1 && modeIndex > 0;
        // An edge swipe has no destination render to release a held preview,
        // so treat it as a cancellation and return immediately from the edge.
        pendingSwipeDirection.value = direction && canMove ? direction : 0;
      })
      .onFinalize(() => {
        'worklet';
        const direction = pendingSwipeDirection.value;
        const wasPrimed = swipePrimed.value;
        pendingSwipeDirection.value = 0;
        swipePrimed.value = false;
        if (!direction) {
          dragX.value = withTiming(0, motion.quick);
          primeProgress.value = withTiming(0, motion.quick);
          if (wasPrimed) runOnJS(playHaptic)('thresholdExit');
        }
        // Mount the incoming FlashList only after RNGH has fully released the
        // dock touch. Committing from `onEnd` let that list inherit the tail of
        // the native gesture and consume its expanded-header padding. Leave a
        // successful swipe visually primed until the resulting `mode` render;
        // the effect above then folds that offset into the destination slide.
        if (direction) runOnJS(commitSwipe)(direction);
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- commitSwipe captures the current mode and callback for this gesture instance
    [
      dragX,
      mode,
      modeIndex,
      onChangeMode,
      pendingSwipeDirection,
      primeProgress,
      sectionWidth,
      slide.extent,
      swipePrimed,
    ]
  );

  const onSectionLayout = (event: LayoutChangeEvent) => {
    sectionWidth.value = event.nativeEvent.layout.width;
  };

  return (
    <Animated.View
      pointerEvents="box-none"
      style={[
        styles.accessory,
        { paddingBottom: bottomClearance },
        accessoryEntranceStyle,
      ]}
    >
      <View style={styles.bar}>
        {selection ? (
          <>
            <Text variant="label" numberOfLines={1} style={styles.selectionCount}>
              {selection.count} selected
            </Text>
            <View style={styles.actions}>
              <ContextAction
                icon="play-skip-forward"
                label={`Play ${selection.count} selected tracks next`}
                disabled={selection.count === 0}
                onPress={selection.onPlayNext}
              />
              <ContextAction
                icon="list-outline"
                label={`Add ${selection.count} selected tracks to the queue`}
                disabled={selection.count === 0}
                onPress={selection.onAddToQueue}
              />
              <ContextAction
                icon="add-circle-outline"
                label={`Add ${selection.count} selected tracks to a playlist`}
                disabled={selection.count === 0}
                onPress={selection.onAddToPlaylist}
              />
              <ContextAction icon="close" label="Cancel selection" onPress={selection.onCancel} />
            </View>
          </>
        ) : (
          <>
            <GestureDetector gesture={swipeGesture}>
              <View style={styles.sections} onLayout={onSectionLayout}>
                <Animated.View
                  pointerEvents="none"
                  style={[styles.activeSection, selectionStyle]}
                />
                {LIBRARY_VIEW_MODES.map((entry) => {
                  const selected = entry.key === mode;
                  return (
                    <Pressable
                      key={entry.key}
                      android_ripple={ripple.bounded}
                      unstable_pressDelay={SCROLL_PRESS_DELAY}
                      onLayout={slide.measure(entry.key)}
                      style={[
                        styles.section,
                        showActiveLabel && selected ? styles.sectionLabelled : styles.sectionIcon,
                      ]}
                      onPress={() => {
                        if (selected) return;
                        playHaptic('selection');
                        onChangeMode(entry.key);
                      }}
                      accessibilityRole="tab"
                      accessibilityLabel={`${entry.label} Library section`}
                      accessibilityHint={
                        selected ? 'Swipe left or right here to change sections' : undefined
                      }
                      accessibilityState={{ selected }}
                    >
                      <Ionicons
                        name={MODE_ICONS[entry.key]}
                        size={19}
                        color={selected ? colors.accent : colors.textSecondary}
                      />
                      {showActiveLabel && selected ? (
                        <Text
                          variant="label"
                          numberOfLines={1}
                          style={styles.sectionLabel}
                          color={colors.accentTextStrong}
                        >
                          {entry.label}
                        </Text>
                      ) : null}
                    </Pressable>
                  );
                })}
              </View>
            </GestureDetector>
            <View style={styles.actions}>
              <ContextAction icon="search" label="Search library" onPress={onSearch} />
              {contextAction ? (
                <ContextAction
                  icon={contextAction.icon}
                  label={contextAction.label}
                  onPress={contextAction.onPress}
                />
              ) : (
                <View style={styles.action} pointerEvents="none" />
              )}
            </View>
          </>
        )}
      </View>
    </Animated.View>
  );
}

function ContextAction({
  icon,
  label,
  disabled = false,
  onPress,
}: {
  icon: IconName;
  label: string;
  disabled?: boolean;
  onPress: () => void;
}) {
  const styles = useStyles();
  const colors = useColors();
  const ripple = useRipple();
  return (
    <Pressable
      android_ripple={ripple.icon(LIBRARY_CONTEXT_ACTION_SIZE / 2)}
      unstable_pressDelay={SCROLL_PRESS_DELAY}
      style={[styles.action, disabled && styles.disabled]}
      disabled={disabled}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
    >
      <Ionicons name={icon} size={20} color={colors.textSecondary} />
    </Pressable>
  );
}

const useStyles = createThemedStyles((colors) => ({
  accessory: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 1,
    paddingTop: LIBRARY_CONTEXT_TOP_GAP,
    paddingHorizontal: spacing.md,
  },
  bar: {
    height: LIBRARY_CONTEXT_BAR_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.bgTertiary,
    borderColor: colors.glassBorderStrong,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.lg,
    overflow: 'hidden',
  },
  sections: {
    flex: 1,
    minWidth: 0,
    height: '100%',
    flexDirection: 'row',
    alignItems: 'center',
  },
  activeSection: {
    position: 'absolute',
    top: spacing.xs,
    bottom: spacing.xs,
    left: 0,
    backgroundColor: colors.glassHighlight,
    borderColor: colors.accent,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.md,
  },
  section: {
    height: '100%',
    minWidth: 0,
    flexBasis: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    overflow: 'hidden',
  },
  sectionIcon: {
    flexGrow: 1,
  },
  sectionLabelled: {
    flexGrow: 2,
    paddingHorizontal: spacing.xs,
  },
  sectionLabel: {
    flexShrink: 1,
    minWidth: 0,
  },
  selectionCount: {
    flex: 1,
    minWidth: 0,
    paddingLeft: spacing.md,
    color: colors.textPrimary,
  },
  actions: {
    flexDirection: 'row',
    flexShrink: 0,
    alignItems: 'center',
  },
  action: {
    width: LIBRARY_CONTEXT_ACTION_SIZE,
    height: LIBRARY_CONTEXT_ACTION_SIZE,
    borderRadius: LIBRARY_CONTEXT_ACTION_SIZE / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  disabled: {
    opacity: 0.4,
  },
}));

export default LibraryContextBar;

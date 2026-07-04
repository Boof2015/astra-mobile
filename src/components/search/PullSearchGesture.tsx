/* eslint-disable react-hooks/immutability -- Reanimated shared values are mutable gesture state. */
import {
  createContext,
  forwardRef,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type MutableRefObject,
  type ReactNode
} from 'react';
import {
  ScrollView as RNScrollView,
  StyleSheet,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type ScrollViewProps
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import {
  Gesture,
  GestureDetector,
  ScrollView as GestureScrollView,
  type GestureType,
  type NativeViewGestureHandlerProps
} from 'react-native-gesture-handler';
import {
  runOnJS,
  runOnUI,
  useSharedValue
} from 'react-native-reanimated';
import { Text } from '@/components/Text';
import {
  colors,
  radius,
  spacing
} from '@/theme';
import { commitHaptic, tickHaptic } from '@/lib/haptics';

const OPEN_THRESHOLD = 76;
const RESET_THRESHOLD = 58;
const MAX_PULL = 112;

type PullSearchGestureRef = MutableRefObject<GestureType | undefined>;
type SimultaneousHandlers = NativeViewGestureHandlerProps['simultaneousHandlers'];
type PullSearchScrollViewProps = ScrollViewProps & Pick<NativeViewGestureHandlerProps, 'simultaneousHandlers'>;
type PullSearchContextValue = {
  gestureRef: PullSearchGestureRef;
  cancelIfScrolledAway: (offsetY: number) => void;
};

const PullSearchGestureContext = createContext<PullSearchContextValue | null>(null);

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function mergeSimultaneousHandlers(
  existing: SimultaneousHandlers,
  contextValue: PullSearchContextValue | null
): SimultaneousHandlers {
  if (!contextValue) return existing;
  if (!existing) return contextValue.gestureRef;
  return Array.isArray(existing)
    ? [...existing, contextValue.gestureRef]
    : [existing, contextValue.gestureRef];
}

export const PullSearchScrollView = forwardRef<RNScrollView, PullSearchScrollViewProps>(
  function PullSearchScrollView({ simultaneousHandlers, onScroll, ...props }, ref) {
    const pullSearchContext = useContext(PullSearchGestureContext);
    const mergedHandlers = useMemo(
      () => mergeSimultaneousHandlers(simultaneousHandlers, pullSearchContext),
      [pullSearchContext, simultaneousHandlers]
    );
    const handleScroll = useCallback(
      (event: NativeSyntheticEvent<NativeScrollEvent>) => {
        onScroll?.(event);
        pullSearchContext?.cancelIfScrolledAway(event.nativeEvent.contentOffset.y);
      },
      [onScroll, pullSearchContext]
    );

    return (
      <GestureScrollView
        ref={ref}
        {...props}
        onScroll={handleScroll}
        simultaneousHandlers={mergedHandlers}
      />
    );
  }
);

/**
 * The pull-to-search Pan gesture ref, so overlaid gestures (e.g. the A-Z rail)
 * can declare relations like `.blocksExternalGesture(ref)` against it.
 */
export function usePullSearchGestureRef(): PullSearchGestureRef | null {
  return useContext(PullSearchGestureContext)?.gestureRef ?? null;
}

export function useScrollTopGate(initialAtTop = true) {
  const atTopRef = useRef(initialAtTop);
  const [atTop, setAtTop] = useState(initialAtTop);

  const setScrollAtTop = useCallback((next: boolean) => {
    if (next === atTopRef.current) return;
    atTopRef.current = next;
    setAtTop(next);
  }, []);

  const onScroll = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      setScrollAtTop(event.nativeEvent.contentOffset.y <= 2);
    },
    [setScrollAtTop]
  );

  return { atTop, onScroll, scrollEventThrottle: 16 as const, setScrollAtTop };
}

export function PullSearchGesture({
  children,
  enabled = true,
  atTop,
  onOpen,
}: {
  children: ReactNode;
  enabled?: boolean;
  atTop: boolean;
  onOpen: () => void;
}) {
  const [pull, setPull] = useState(0);
  const [armed, setArmed] = useState(false);
  const [dragging, setDragging] = useState(false);
  const pullGestureRef = useMemo<PullSearchGestureRef>(() => ({ current: undefined }), []);
  const pullValue = useSharedValue(0);
  const armedValue = useSharedValue(false);
  const draggingValue = useSharedValue(false);

  const resetUi = useCallback(() => {
    setArmed(false);
    setPull(0);
    setDragging(false);
  }, []);

  const open = useCallback(() => {
    commitHaptic();
    onOpen();
    resetUi();
  }, [onOpen, resetUi]);

  const resetShared = useCallback(() => {
    runOnUI(() => {
      'worklet';
      pullValue.value = 0;
      armedValue.value = false;
      draggingValue.value = false;
    })();
  }, [armedValue, draggingValue, pullValue]);

  const cancelIfScrolledAway = useCallback(
    (offsetY: number) => {
      if (offsetY <= 2 || !dragging) return;
      resetShared();
      resetUi();
    },
    [dragging, resetShared, resetUi]
  );

  const contextValue = useMemo<PullSearchContextValue>(
    () => ({ gestureRef: pullGestureRef, cancelIfScrolledAway }),
    [cancelIfScrolledAway, pullGestureRef]
  );

  const pullGesture = useMemo(
    () =>
      Gesture.Pan()
        .withRef(pullGestureRef)
        .enabled(enabled && atTop)
        .activeOffsetY(10)
        .failOffsetY(-8)
        .failOffsetX([-28, 28])
        .onStart(() => {
          'worklet';
          pullValue.value = 0;
          armedValue.value = false;
          draggingValue.value = true;
          runOnJS(setPull)(0);
          runOnJS(setArmed)(false);
          runOnJS(setDragging)(true);
        })
        .onChange((event) => {
          'worklet';
          const nextPull = Math.max(0, Math.min(MAX_PULL, pullValue.value + event.changeY));
          pullValue.value = nextPull;
          runOnJS(setPull)(nextPull);

          if (!armedValue.value && nextPull >= OPEN_THRESHOLD) {
            armedValue.value = true;
            runOnJS(setArmed)(true);
            runOnJS(tickHaptic)();
          } else if (armedValue.value && nextPull < RESET_THRESHOLD) {
            armedValue.value = false;
            runOnJS(setArmed)(false);
          }
        })
        .onEnd((event) => {
          'worklet';
          const finalPull = pullValue.value;
          pullValue.value = 0;
          armedValue.value = false;
          draggingValue.value = false;

          if (finalPull >= OPEN_THRESHOLD || (finalPull > 44 && event.velocityY > 1250)) {
            runOnJS(open)();
            return;
          }
          runOnJS(resetUi)();
        })
        .onFinalize((_event, success) => {
          'worklet';
          if (success) return;
          pullValue.value = 0;
          armedValue.value = false;
          draggingValue.value = false;
          runOnJS(resetUi)();
        }),
    [
      armedValue,
      atTop,
      draggingValue,
      enabled,
      open,
      pullGestureRef,
      pullValue,
      resetUi,
    ]
  );

  const progress = clamp(pull / OPEN_THRESHOLD, 0, 1);
  const indicatorStyle = {
    opacity: pull <= 0 ? 0 : Math.max(0.72, progress),
    transform: [
      { translateY: -18 + (clamp(pull, 0, MAX_PULL) / MAX_PULL) * 38 },
      { scale: armed ? 1.03 : 0.94 + progress * 0.06 },
    ],
  };

  return (
    <PullSearchGestureContext.Provider value={contextValue}>
      <GestureDetector gesture={pullGesture}>
        <View collapsable={false} style={styles.root}>
          {children}
          {dragging ? (
            <View pointerEvents="none" style={[styles.indicator, indicatorStyle]}>
              <Ionicons name="search" size={16} color={armed ? colors.accentTextStrong : colors.textSecondary} />
              <Text variant="label" color={armed ? colors.accentTextStrong : colors.textSecondary}>
                {armed ? 'Release' : 'Search'}
              </Text>
            </View>
          ) : null}
        </View>
      </GestureDetector>
    </PullSearchGestureContext.Provider>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  indicator: {
    position: 'absolute',
    top: spacing.xs,
    alignSelf: 'center',
    zIndex: 20,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glassBorder,
    backgroundColor: colors.bgTertiary,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    shadowColor: '#000',
    shadowOpacity: 0.28,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 8 },
    elevation: 10,
  },
});

/* eslint-disable react-hooks/immutability, react-hooks/refs -- the fade-through retains committed React content in refs and drives its single visual layer on the UI thread. */
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import Animated, {
  Easing,
  ReduceMotion,
  cancelAnimation,
  runOnJS,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import {
  resolveLibraryViewModeTransition,
  type LibraryViewMode,
  type LibraryViewModeDirection,
} from '@/library/libraryViewMode';

export const LIBRARY_SURFACE_TRANSLATION_DP = 16;
export const LIBRARY_SURFACE_EXIT_MS = 60;
export const LIBRARY_SURFACE_ENTER_MS = 100;

const EXIT = {
  duration: LIBRARY_SURFACE_EXIT_MS,
  easing: Easing.in(Easing.cubic),
  reduceMotion: ReduceMotion.System,
} as const;
const ENTER = {
  duration: LIBRARY_SURFACE_ENTER_MS,
  easing: Easing.out(Easing.cubic),
  reduceMotion: ReduceMotion.System,
} as const;

type TravelDirection = Exclude<LibraryViewModeDirection, 0>;
type TransitionPhase = 'idle' | 'exiting' | 'switching' | 'entering';

interface SurfaceLayer {
  mode: LibraryViewMode;
  children: ReactNode;
  direction: TravelDirection;
}

interface DisplayState {
  mode: LibraryViewMode;
  generation: number;
}

export interface LibrarySurfaceTransitionProps {
  mode: LibraryViewMode;
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
}

function travelDirection(direction: LibraryViewModeDirection, fallback: TravelDirection): TravelDirection {
  return direction === 0 ? fallback : direction;
}

function outgoingOffset(direction: TravelDirection): number {
  return direction * -LIBRARY_SURFACE_TRANSLATION_DP;
}

function incomingOffset(direction: TravelDirection): number {
  return direction * LIBRARY_SURFACE_TRANSLATION_DP;
}

/**
 * Directional, single-layer fade-through for the Library's heavyweight list
 * surfaces. The outgoing FlashList is fully hidden before React swaps in the
 * newest requested mode, so rapid switches never retain parallel catalog
 * lists or compete for scroll/gesture callbacks.
 */
export function LibrarySurfaceTransition({
  mode,
  children,
  style,
}: LibrarySurfaceTransitionProps) {
  const reducedMotion = useReducedMotion();
  const [display, setDisplay] = useState<DisplayState>({ mode, generation: 0 });
  const initialLayer: SurfaceLayer = { mode, children, direction: 1 };
  const committedLayer = useRef<SurfaceLayer>(initialLayer);
  const latestRequest = useRef<SurfaceLayer>(initialLayer);
  const phase = useRef<TransitionPhase>('idle');
  const exitDirection = useRef<TravelDirection | null>(null);
  const animationToken = useRef(0);
  const enteredGeneration = useRef(0);
  const visibility = useSharedValue(1);
  const translateX = useSharedValue(0);
  const request = resolveLibraryViewModeTransition(display.mode, mode, reducedMotion);
  const requestedDirection = travelDirection(request.direction, committedLayer.current.direction);

  const finishEntrance = useCallback((token: number) => {
    if (animationToken.current !== token) return;
    phase.current = 'idle';
    exitDirection.current = null;
  }, []);

  const commitLatestRequest = useCallback((token: number) => {
    if (animationToken.current !== token) return;
    const next = latestRequest.current;
    phase.current = 'switching';
    committedLayer.current = next;
    setDisplay((current) => ({
      mode: next.mode,
      generation: current.generation + 1,
    }));
  }, []);

  // Capture the latest props on every commit, but preserve the visible layer
  // while another mode is fading out.
  useLayoutEffect(() => {
    const next: SurfaceLayer = { mode, children, direction: requestedDirection };
    latestRequest.current = next;
    if (display.mode === mode) committedLayer.current = next;
  }, [children, display.mode, mode, requestedDirection]);

  // Reduced Motion is a true cut. Rendering below already uses the current
  // children immediately; this synchronises the retained bookkeeping and
  // cancels any transition that was in flight when the setting changed.
  useLayoutEffect(() => {
    if (!reducedMotion) return;
    animationToken.current += 1;
    phase.current = 'idle';
    exitDirection.current = null;
    cancelAnimation(visibility);
    cancelAnimation(translateX);
    visibility.value = 1;
    translateX.value = 0;
    committedLayer.current = latestRequest.current;
    if (display.mode !== mode) {
      setDisplay((current) => {
        const generation = current.generation + 1;
        enteredGeneration.current = generation;
        return { mode, generation };
      });
    } else {
      enteredGeneration.current = display.generation;
    }
  }, [display.generation, display.mode, mode, reducedMotion, translateX, visibility]);

  // Once the outgoing layer is transparent, mount only the newest request and
  // enter it from the matching side. A newer request that landed during the
  // React handoff replaces this one before it becomes visible.
  useLayoutEffect(() => {
    if (display.generation === 0 || reducedMotion) return;
    if (enteredGeneration.current === display.generation) return;
    enteredGeneration.current = display.generation;

    const latest = latestRequest.current;
    if (latest.mode !== display.mode) {
      phase.current = 'switching';
      committedLayer.current = latest;
      setDisplay((current) => ({
        mode: latest.mode,
        generation: current.generation + 1,
      }));
      return;
    }

    const token = animationToken.current;
    const direction = committedLayer.current.direction;
    phase.current = 'entering';
    cancelAnimation(visibility);
    cancelAnimation(translateX);
    visibility.value = 0;
    translateX.value = incomingOffset(direction);
    visibility.value = withTiming(1, ENTER, (finished) => {
      if (finished) runOnJS(finishEntrance)(token);
    });
    translateX.value = withTiming(0, ENTER);
  }, [
    display.generation,
    display.mode,
    finishEntrance,
    reducedMotion,
    translateX,
    visibility,
  ]);

  // Start or re-aim the exit. Requests arriving mid-exit only replace
  // latestRequest; the completion callback always commits that newest target.
  useLayoutEffect(() => {
    if (reducedMotion) return;

    if (display.mode === mode) {
      if (phase.current !== 'exiting') return;
      const token = ++animationToken.current;
      phase.current = 'entering';
      exitDirection.current = null;
      cancelAnimation(visibility);
      cancelAnimation(translateX);
      visibility.value = withTiming(1, ENTER, (finished) => {
        if (finished) runOnJS(finishEntrance)(token);
      });
      translateX.value = withTiming(0, ENTER);
      return;
    }

    if (phase.current === 'exiting') {
      if (exitDirection.current !== requestedDirection) {
        exitDirection.current = requestedDirection;
        cancelAnimation(translateX);
        translateX.value = withTiming(outgoingOffset(requestedDirection), EXIT);
      }
      return;
    }

    if (phase.current === 'switching') return;

    const token = ++animationToken.current;
    phase.current = 'exiting';
    exitDirection.current = requestedDirection;
    cancelAnimation(visibility);
    cancelAnimation(translateX);
    visibility.value = withTiming(0, EXIT, (finished) => {
      if (finished) runOnJS(commitLatestRequest)(token);
    });
    translateX.value = withTiming(outgoingOffset(requestedDirection), EXIT);
  }, [
    commitLatestRequest,
    display.mode,
    finishEntrance,
    mode,
    reducedMotion,
    requestedDirection,
    translateX,
    visibility,
  ]);

  useEffect(() => () => {
    animationToken.current += 1;
    cancelAnimation(visibility);
    cancelAnimation(translateX);
  }, [translateX, visibility]);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: visibility.value,
    transform: [{ translateX: translateX.value }],
  }));
  const renderedChildren = reducedMotion
    ? children
    : display.mode === mode
      ? children
      : committedLayer.current.children;

  return (
    <View collapsable={false} style={[styles.container, style]}>
      <Animated.View style={[styles.layer, reducedMotion ? null : animatedStyle]}>
        {renderedChildren}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    overflow: 'hidden',
  },
  layer: {
    flex: 1,
  },
});

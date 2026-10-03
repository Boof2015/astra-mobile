/* eslint-disable react-hooks/immutability, react-hooks/refs -- the fade-through keeps committed React content in refs and drives its single visual layer on the UI thread. */
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
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
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import type { PlaybackPresentation } from '@/playback/playbackTargetPresentation';
import type { PlaybackTarget } from '@/stores/playbackTargetStore';
import {
  resolveNowPlayingTrackTransitionDirection,
  useNowPlayingTrackTransitionStore,
  type NowPlayingTrackTransitionDirection,
} from '@/stores/nowPlayingTrackTransitionStore';

const EXIT = {
  duration: 110,
  easing: Easing.in(Easing.cubic),
  reduceMotion: ReduceMotion.System,
} as const;
const ENTER = {
  duration: 190,
  easing: Easing.out(Easing.cubic),
  reduceMotion: ReduceMotion.System,
} as const;
const SLIDE_DISTANCE = 14;

interface TrackLayer {
  key: string;
  children: ReactNode;
  direction: NowPlayingTrackTransitionDirection;
}

interface DisplayState {
  key: string;
  generation: number;
}

type TransitionPhase = 'idle' | 'exiting' | 'switching' | 'entering';

interface NowPlayingTrackFadeThroughProps {
  transitionKey: string;
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  contentStyle?: StyleProp<ViewStyle>;
}

/**
 * Track keys can be shared across playback targets, so target identity is part
 * of the transition key. Progress and metadata updates keep the same key.
 */
export function getNowPlayingTrackTransitionKey(
  target: PlaybackPresentation['target'],
  trackKey: string | null
): string {
  return `${target}:${trackKey ?? 'none'}`;
}

function getTargetFromTransitionKey(transitionKey: string): PlaybackTarget {
  return transitionKey.startsWith('desktop:') ? 'desktop' : 'phone';
}

function outgoingOffset(direction: NowPlayingTrackTransitionDirection): number {
  return direction === 'next' ? -SLIDE_DISTANCE : SLIDE_DISTANCE;
}

function incomingOffset(direction: NowPlayingTrackTransitionDirection): number {
  return -outgoingOffset(direction);
}

/**
 * Single-layer directional fade-through. Next fades left and enters from the
 * right; previous mirrors it. Content swaps only while fully transparent, so
 * two tracks are never mounted together and rapid skipping cannot stack or
 * alternate outgoing metadata layers.
 */
export function NowPlayingTrackFadeThrough({
  transitionKey,
  children,
  style,
  contentStyle,
}: NowPlayingTrackFadeThroughProps) {
  const directionHint = useNowPlayingTrackTransitionStore((state) => state.hint);
  const requestedDirection = resolveNowPlayingTrackTransitionDirection(
    directionHint,
    getTargetFromTransitionKey(transitionKey),
  );
  const [display, setDisplay] = useState<DisplayState>({
    key: transitionKey,
    generation: 0,
  });
  const committedLayer = useRef<TrackLayer>({
    key: transitionKey,
    children,
    direction: requestedDirection,
  });
  const latestRequest = useRef<TrackLayer>({
    key: transitionKey,
    children,
    direction: requestedDirection,
  });
  const phase = useRef<TransitionPhase>('idle');
  const exitDirection = useRef<NowPlayingTrackTransitionDirection | null>(null);
  const animationToken = useRef(0);
  const visibility = useSharedValue(1);
  const translateX = useSharedValue(0);

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
      key: next.key,
      generation: current.generation + 1,
    }));
  }, []);

  // Capture the latest props every commit, but preserve the visible layer while
  // a different track is fading out.
  useLayoutEffect(() => {
    latestRequest.current = {
      key: transitionKey,
      children,
      direction: requestedDirection,
    };
    if (display.key === transitionKey) {
      committedLayer.current = latestRequest.current;
    }
  }, [children, display.key, requestedDirection, transitionKey]);

  // Once the outgoing layer is hidden, mount only the newest requested track
  // and fade that single layer in.
  useLayoutEffect(() => {
    if (display.generation === 0) return undefined;

    const latest = latestRequest.current;
    if (latest.key !== display.key) {
      phase.current = 'switching';
      committedLayer.current = latest;
      setDisplay((current) => ({
        key: latest.key,
        generation: current.generation + 1,
      }));
      return undefined;
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
    return undefined;
  }, [
    display.generation,
    display.key,
    finishEntrance,
    translateX,
    visibility,
  ]);

  // Start the fade-out for a new key. Requests arriving during that exit only
  // update latestRequest; the midpoint commits the newest one. If the request
  // returns to the visible key, reverse cleanly instead of swapping away/back.
  useLayoutEffect(() => {
    if (display.key === transitionKey) {
      if (phase.current !== 'exiting') return undefined;
      const token = ++animationToken.current;
      phase.current = 'entering';
      exitDirection.current = null;
      cancelAnimation(visibility);
      cancelAnimation(translateX);
      visibility.value = withTiming(1, ENTER, (finished) => {
        if (finished) runOnJS(finishEntrance)(token);
      });
      translateX.value = withTiming(0, ENTER);
      return undefined;
    }

    if (phase.current === 'exiting') {
      const direction = latestRequest.current.direction;
      if (exitDirection.current !== direction) {
        exitDirection.current = direction;
        cancelAnimation(translateX);
        translateX.value = withTiming(outgoingOffset(direction), EXIT);
      }
      return undefined;
    }

    if (phase.current === 'switching') {
      return undefined;
    }

    const token = ++animationToken.current;
    const direction = latestRequest.current.direction;
    phase.current = 'exiting';
    exitDirection.current = direction;
    cancelAnimation(visibility);
    cancelAnimation(translateX);
    visibility.value = withTiming(0, EXIT, (finished) => {
      if (finished) runOnJS(commitLatestRequest)(token);
    });
    translateX.value = withTiming(outgoingOffset(direction), EXIT);
    return undefined;
  }, [
    commitLatestRequest,
    display.key,
    finishEntrance,
    requestedDirection,
    transitionKey,
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
  const renderedChildren =
    display.key === transitionKey ? children : committedLayer.current.children;

  return (
    <View collapsable={false} style={[{ position: 'relative' }, style]}>
      <Animated.View
        key={display.key}
        style={[contentStyle, animatedStyle]}
      >
        {renderedChildren}
      </Animated.View>
    </View>
  );
}

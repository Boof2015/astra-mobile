import { useEffectEvent, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import { Image } from 'expo-image';
import Animated, {
  Easing,
  ReduceMotion,
  cancelAnimation,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import {
  resolveNowPlayingTrackTransitionDirection,
  useNowPlayingTrackTransitionStore,
} from '@/stores/nowPlayingTrackTransitionStore';

/**
 * Now-playing's cover, as a two-card carousel: on a track change the current
 * card slides out one side while the incoming one slides in from the other,
 * the two a gap apart like pages. Buttons, swipes and auto-advance all use it.
 *
 * While a finger drags the cover only the current card moves (`dragX`); the
 * neighbor is never shown as a preview. When a swipe commits, the outgoing
 * card carries on from wherever the finger left it.
 *
 * Every card renders its thumbnail first and sharpens to the full cover when
 * that is decoded, so a card is never blank mid-slide (it used to sit empty
 * for ~350ms while the full-size cover decoded).
 */

export interface NowPlayingArtCover {
  /** Transition key of the track (`getNowPlayingTrackTransitionKey`). */
  key: string;
  uri: string | null;
  /** Low-res thumbnail, shown instantly while `uri` decodes. */
  thumb: string | null;
}

const SLIDE = {
  duration: 300,
  easing: Easing.bezier(0.22, 1, 0.36, 1),
  reduceMotion: ReduceMotion.System,
} as const;
const PARKED = 100_000;

interface NowPlayingArtCarouselProps {
  cover: NowPlayingArtCover | null;
  /**
   * How far a card travels between center and parked. Must clear the screen
   * edge at the cover's current on-screen scale, or the outgoing card ends as a
   * sliver at the edge (`getNowPlayingArtSlideTravel`).
   */
  travel: number;
  /** +1 = forward (old card exits left), -1 = back. Omitted: the transport's own hint. */
  direction?: 1 | -1;
  dragX: SharedValue<number>;
  cardStyle: StyleProp<ViewStyle>;
  /** Shown on a card whose track has no artwork. */
  fallback: ReactNode;
}

export function NowPlayingArtCarousel({
  cover,
  travel,
  direction,
  dragX,
  cardStyle,
  fallback,
}: NowPlayingArtCarouselProps) {
  const hint = useNowPlayingTrackTransitionStore((state) => state.hint);
  const hintDirection = resolveNowPlayingTrackTransitionDirection(hint, 'phone') === 'previous' ? -1 : 1;
  const nextDirection = direction ?? hintDirection;

  const [slots, setSlots] = useState<[NowPlayingArtCover | null, NowPlayingArtCover | null]>([cover, null]);
  const front = useRef(0);
  const frontIndex = useSharedValue(0);
  const x0 = useSharedValue(0);
  const x1 = useSharedValue(PARKED);
  const shown = useRef<{ key: string | null; previousKey: string | null; direction: 1 | -1 }>({
    key: cover?.key ?? null,
    previousKey: null,
    direction: 1,
  });
  const generation = useRef(0);

  const releaseSlot = (slot: number, gen: number) => {
    if (generation.current !== gen || front.current === slot) return;
    setSlots((current) => {
      const next: typeof current = [current[0], current[1]];
      next[slot] = null;
      return next;
    });
  };

  // An effect event so the slide can key on the cover's fields: the cover
  // object's identity changes with every parent render.
  const showCover = useEffectEvent(() => {
    const key = cover?.key ?? null;
    const last = shown.current;
    if (key === last.key) {
      // Same track, new data (e.g. its artwork resolved): update the card in place.
      setSlots((current) => {
        const next: typeof current = [current[0], current[1]];
        next[front.current] = cover;
        return next;
      });
      return;
    }

    // Going back to the cover that just left reverses that slide, so a failed
    // swipe (or next-then-previous) returns the way it came.
    const dir: 1 | -1 = key !== null && key === last.previousKey ? (-last.direction as 1 | -1) : nextDirection;
    shown.current = { key, previousKey: last.key, direction: dir };
    const gen = ++generation.current;
    const outgoing = front.current;
    const incoming = 1 - outgoing;
    const xOut = outgoing === 0 ? x0 : x1;
    const xIn = incoming === 0 ? x0 : x1;

    // The outgoing card starts exactly where it is on screen, drag included.
    cancelAnimation(dragX);
    cancelAnimation(xOut);
    cancelAnimation(xIn);
    xOut.set(xOut.get() + dragX.get());
    dragX.set(0);
    xIn.set(dir * travel);
    front.current = incoming;
    frontIndex.set(incoming);

    setSlots((current) => {
      const next: typeof current = [current[0], current[1]];
      next[incoming] = cover;
      return next;
    });
    xOut.set(withTiming(-dir * travel, SLIDE, (finished) => {
      if (!finished) return;
      // Off screen now; park it far away so its empty frame can never show.
      xOut.set(PARKED);
      runOnJS(releaseSlot)(outgoing, gen);
    }));
    xIn.set(withTiming(0, SLIDE));
  });

  // useLayoutEffect: the incoming card is parked off screen before the frame
  // that mounts its image, so it can never flash in place.
  useLayoutEffect(() => {
    showCover();
  }, [cover?.key, cover?.uri, cover?.thumb]);

  const style0 = useAnimatedStyle(() => ({
    transform: [{ translateX: x0.value + (frontIndex.value === 0 ? dragX.value : 0) }],
  }));
  const style1 = useAnimatedStyle(() => ({
    transform: [{ translateX: x1.value + (frontIndex.value === 1 ? dragX.value : 0) }],
  }));

  return (
    <>
      {[0, 1].map((slot) => {
        const card = slots[slot];
        return (
          <Animated.View
            key={slot}
            pointerEvents="none"
            style={[StyleSheet.absoluteFill, cardStyle, slot === 0 ? style0 : style1]}
          >
            {card ? (
              card.uri ? (
                <Image
                  // A new track remounts the image rather than swapping its
                  // source, so the outgoing card can never show the new cover.
                  key={card.key}
                  source={{ uri: card.uri }}
                  placeholder={card.thumb ? { uri: card.thumb } : undefined}
                  placeholderContentFit="cover"
                  style={styles.image}
                  contentFit="cover"
                  cachePolicy="memory-disk"
                  allowDownscaling
                  transition={120}
                />
              ) : (
                fallback
              )
            ) : null}
          </Animated.View>
        );
      })}
    </>
  );
}

const styles = StyleSheet.create({
  image: {
    width: '100%',
    height: '100%',
  },
});

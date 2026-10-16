import { useEffect, useEffectEvent, useLayoutEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { PixelRatio, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import { Image, type ImageRef } from 'expo-image';
import Animated, {
  Easing,
  ReduceMotion,
  cancelAnimation,
  runOnJS,
  runOnUI,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import {
  resolveNowPlayingTrackTransitionDirection,
  useNowPlayingTrackTransitionStore,
} from '@/stores/nowPlayingTrackTransitionStore';

import { artworkRequestKey, NowPlayingArtworkCache } from './nowPlayingArtworkCache';
import { advanceArtTransition, canReleaseArtSlot, type ArtTransition } from './nowPlayingArtTransition';
import { predictNeighborArtCover } from './nowPlayingArtNeighbors';
import { ARTWORK_COLORS_SETTLE_MS } from '@/theme/useNowPlayingArtworkColors';

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

function sameCover(a: NowPlayingArtCover | null, b: NowPlayingArtCover | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return a.key === b.key && a.uri === b.uri && a.thumb === b.thumb;
}

const SLIDE = {
  duration: 300,
  easing: Easing.bezier(0.22, 1, 0.36, 1),
  reduceMotion: ReduceMotion.System,
} as const;
const PARKED = 100_000;
const SHARPEN_MS = 120;

interface NowPlayingArtCarouselProps {
  cover: NowPlayingArtCover | null;
  /** Unscaled cover edge in layout points. */
  size: number;
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
  size,
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
  const frontIndex = useSharedValue(0);
  const x0 = useSharedValue(0);
  const x1 = useSharedValue(PARKED);
  const shown = useRef<ArtTransition>({
    key: cover?.key ?? null,
    previousKey: null,
    direction: 1,
    front: 0,
    generation: 0,
  });
  const pixelSize = Math.max(1, Math.ceil(size * PixelRatio.get()));
  const [cache] = useState(() => new NowPlayingArtworkCache<ImageRef>(
    ({ uri, pixelSize: edge }) => Image.loadAsync(uri, { maxWidth: edge, maxHeight: edge }),
  ));
  const [neighbors, setNeighbors] = useState<{ key: string | null; covers: NowPlayingArtCover[] } | null>(null);
  const coverKey = cover?.key ?? null;

  useEffect(() => {
    const timer = setTimeout(() => {
      const covers = [predictNeighborArtCover('next'), predictNeighborArtCover('previous')]
        .filter((item): item is NowPlayingArtCover => item !== null);
      setNeighbors({ key: coverKey, covers });
    }, ARTWORK_COLORS_SETTLE_MS + 150);
    return () => clearTimeout(timer);
  }, [coverKey]);

  useEffect(() => {
    const warm = neighbors?.key === coverKey ? neighbors.covers : [];
    // Current first, then the outgoing slot, then neighbors. Album duplicates
    // share a decode. Slots keep their refs until their exit completes.
    const covers = [cover, ...slots, ...warm];
    cache.setRequests(covers.flatMap((item) => item?.uri ? [{ uri: item.uri, pixelSize }] : []));
  }, [cache, cover, coverKey, neighbors, pixelSize, slots]);
  useEffect(() => () => cache.clear(), [cache]);

  const releaseSlot = (slot: number, gen: number) => {
    if (!canReleaseArtSlot(shown.current, slot, gen)) return;
    const neighbors = [predictNeighborArtCover('next'), predictNeighborArtCover('previous')];
    setSlots((current) => {
      if (!canReleaseArtSlot(shown.current, slot, gen) || !current[slot]) return current;
      // Keep an immediate neighbor mounted at PARKED. Returning to it can
      // reuse its native image view and GPU texture as well as its decode.
      // Arbitrary jumps release the old card as soon as its exit finishes.
      if (neighbors.some((neighbor) => sameCover(neighbor, current[slot]))) return current;
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
        const front = shown.current.front;
        const previous = current[front];
        if (sameCover(previous, cover)) return current;
        const next: typeof current = [current[0], current[1]];
        next[front] = cover;
        return next;
      });
      return;
    }

    // Going back to the cover that just left reverses that slide, so a failed
    // swipe (or next-then-previous) returns the way it came.
    const next = advanceArtTransition(last, key, nextDirection);
    shown.current = next;
    const { direction: dir, generation: gen, front: incoming } = next;
    const outgoing = last.front;
    const xOut = outgoing === 0 ? x0 : x1;
    const xIn = incoming === 0 ? x0 : x1;

    // One UI task samples the actual on-screen position and starts both cards.
    // JS never waits for the rendering thread to read a shared value.
    runOnUI(() => {
      cancelAnimation(dragX);
      cancelAnimation(xOut);
      cancelAnimation(xIn);
      xOut.set(xOut.get() + dragX.get());
      dragX.set(0);
      xIn.set(dir * travel);
      frontIndex.set(incoming);
      xOut.set(withTiming(-dir * travel, SLIDE, (finished) => {
        if (!finished) return;
        xOut.set(PARKED);
        runOnJS(releaseSlot)(outgoing, gen);
      }));
      xIn.set(withTiming(0, SLIDE));
    })();
    setSlots((current) => {
      if (sameCover(current[incoming], cover)) return current;
      const updated: typeof current = [current[0], current[1]];
      updated[incoming] = cover;
      return updated;
    });
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
                <DecodedCover
                  key={`${card.key}:${pixelSize}:${card.uri ?? ''}`}
                  card={card}
                  cache={cache}
                  pixelSize={pixelSize}
                  fallback={fallback}
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

function DecodedCover({ card, cache, pixelSize, fallback }: {
  card: NowPlayingArtCover;
  cache: NowPlayingArtworkCache<ImageRef>;
  pixelSize: number;
  fallback: ReactNode;
}) {
  const image = useSyncExternalStore(cache.subscribe, () =>
    card.uri ? cache.get({ uri: card.uri, pixelSize }) : null,
  );
  const sourceKey = artworkRequestKey({ uri: card.uri ?? '', pixelSize });
  const [displayedKey, setDisplayedKey] = useState<string | null>(null);
  const [settledKey, setSettledKey] = useState<string | null>(null);
  const [failedThumb, setFailedThumb] = useState<string | null>(null);
  useEffect(() => {
    if (displayedKey !== sourceKey) return;
    // Keep the thumb in its own native view throughout the full cover's fade.
    // Replacing a URI source with an ImageRef in one view could clear the thumb
    // before the new drawable appeared during rapid skips. A source/size change
    // cancels this completion so it cannot remove a newer cover's placeholder.
    const timer = setTimeout(() => setSettledKey(sourceKey), SHARPEN_MS);
    return () => clearTimeout(timer);
  }, [displayedKey, sourceKey]);
  return (
    <>
      {!image || settledKey !== sourceKey ? (
        card.thumb && failedThumb !== card.thumb ? (
          <Image
            key={card.thumb}
            source={{ uri: card.thumb }}
            style={StyleSheet.absoluteFill}
            contentFit="cover"
            cachePolicy="memory-disk"
            onError={() => setFailedThumb(card.thumb)}
          />
        ) : fallback
      ) : null}
      <Image
        key={sourceKey}
        source={image}
        style={StyleSheet.absoluteFill}
        contentFit="cover"
        cachePolicy="memory-disk"
        allowDownscaling
        transition={SHARPEN_MS}
        onDisplay={() => setDisplayedKey(sourceKey)}
      />
    </>
  );
}

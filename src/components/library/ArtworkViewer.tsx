import { useEffect, useState } from 'react';
import { Modal, StyleSheet, View, useWindowDimensions } from 'react-native';
import { Image, type ImageLoadEventData } from 'expo-image';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, {
  Easing,
  ReduceMotion,
  runOnJS,
  runOnUI,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import { motion } from '@/theme/motion';
import { useColors } from '@/theme/themed';
import {
  ARTWORK_VIEWER_DOUBLE_TAP_ZOOM,
  ARTWORK_VIEWER_OVERSAMPLE,
  ARTWORK_VIEWER_ZOOMED_THRESHOLD,
  clampLiveZoom,
  clampPan,
  clampRestingZoom,
  getArtworkTravel,
  getArtworkViewerTarget,
  getDragProgress,
  normalizeArtworkAspect,
  shouldDismissDrag,
  zoomAbout,
  type ArtworkViewerOrigin,
} from '@/components/library/artworkViewerLayout';

// Full-screen artwork viewer for the detail hero. The hero artwork appears to
// lift off the page: the viewer starts as an exact overlay of it (same square,
// same crop), hides the original, and travels to fill the window. Closing
// reverses the trip and hands the pixels back.
//
// Nothing here animates layout. The frame is laid out at its final rect and
// only transform, opacity and radius change per frame; see artworkViewerLayout.

const PHASE_WAITING = 0;
const PHASE_OPEN = 1;
const PHASE_CLOSING = 2;

const OPEN_TIMING = {
  duration: 300,
  easing: Easing.out(Easing.cubic),
  reduceMotion: ReduceMotion.System,
} as const;
const CLOSE_TIMING = {
  duration: 240,
  easing: Easing.out(Easing.cubic),
  reduceMotion: ReduceMotion.System,
} as const;

/**
 * The trip starts once the image has decoded at viewer size, so the hero is
 * never swapped for an empty frame. A cover that takes longer than this (a
 * slow remote source) opens anyway and fills in when it arrives.
 */
const LOAD_TIMEOUT_MS = 450;
const BACKDROP_OPACITY = 0.95;
/** How much a dismiss drag fades the backdrop and shrinks the image. */
const DRAG_BACKDROP_FADE = 0.7;
const DRAG_SHRINK = 0.18;

export function ArtworkViewer({
  uri,
  origin,
  label,
  heroOpacity,
  onClosed,
}: {
  uri: string;
  /** The hero artwork's square, in window coordinates, when it was tapped. */
  origin: ArtworkViewerOrigin;
  /** Names what the artwork belongs to, for screen readers. */
  label: string;
  /** Opacity of the hero artwork, which the viewer hides while it stands in for it. */
  heroOpacity: SharedValue<number>;
  onClosed: () => void;
}) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const [openedIn] = useState({ width: windowWidth, height: windowHeight });
  const [aspect, setAspect] = useState<number | null>(null);
  const [timedOut, setTimedOut] = useState(false);

  const target = getArtworkViewerTarget(windowWidth, windowHeight, insets, aspect ?? 1);
  const centerX = target.x + target.width / 2;
  const centerY = target.y + target.height / 2;
  // The origin is only where the hero sits in the window it was measured in.
  // After a rotation the image fades out instead of flying to a stale spot.
  const travelBack = openedIn.width === windowWidth && openedIn.height === windowHeight;
  const ready = aspect !== null || timedOut;

  const phase = useSharedValue(PHASE_WAITING);
  const progress = useSharedValue(0);
  const visibility = useSharedValue(0);
  const scale = useSharedValue(1);
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);
  const pinching = useSharedValue(false);

  useEffect(() => {
    const timer = setTimeout(() => setTimedOut(true), LOAD_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!ready) return;
    // One frame later, so a non-square cover's frame is laid out at its real
    // aspect before it becomes visible.
    const frame = requestAnimationFrame(() => {
      runOnUI(() => {
        'worklet';
        if (phase.get() !== PHASE_WAITING) return;
        phase.set(PHASE_OPEN);
        visibility.set(1);
        heroOpacity.set(0);
        progress.set(withTiming(1, OPEN_TIMING));
      })();
    });
    return () => cancelAnimationFrame(frame);
  }, [ready, phase, visibility, heroOpacity, progress]);

  // A resized window invalidates the pan limits the zoom was settled against.
  useEffect(() => {
    scale.set(1);
    translateX.set(0);
    translateY.set(0);
  }, [windowWidth, windowHeight, scale, translateX, translateY]);

  // Declared before the gestures: a worklet captures the helpers it calls at
  // its own declaration.
  const dismiss = () => {
    'worklet';
    const current = phase.get();
    if (current === PHASE_CLOSING) return;
    phase.set(PHASE_CLOSING);
    if (current === PHASE_WAITING) {
      runOnJS(onClosed)();
      return;
    }
    scale.set(withTiming(1, CLOSE_TIMING));
    translateX.set(withTiming(0, CLOSE_TIMING));
    translateY.set(withTiming(0, CLOSE_TIMING));
    if (travelBack) {
      progress.set(
        withTiming(0, CLOSE_TIMING, () => {
          'worklet';
          // The viewer is sitting exactly on the hero again: reveal it first,
          // then let the modal go.
          heroOpacity.set(1);
          runOnJS(onClosed)();
        })
      );
    } else {
      heroOpacity.set(1);
      visibility.set(
        withTiming(0, CLOSE_TIMING, () => {
          'worklet';
          runOnJS(onClosed)();
        })
      );
    }
  };

  const settle = () => {
    'worklet';
    const resting = clampRestingZoom(scale.get());
    scale.set(withTiming(resting, motion.snap));
    translateX.set(
      withTiming(
        clampPan(translateX.get(), target.x, target.width, resting, windowWidth),
        motion.snap
      )
    );
    translateY.set(
      withTiming(
        clampPan(translateY.get(), target.y, target.height, resting, windowHeight),
        motion.snap
      )
    );
  };

  const pinch = Gesture.Pinch()
    .onStart(() => {
      pinching.set(true);
    })
    .onChange((event) => {
      if (phase.get() !== PHASE_OPEN) return;
      const previous = scale.get();
      const next = clampLiveZoom(previous * event.scaleChange);
      const ratio = next / previous;
      translateX.set(zoomAbout(event.focalX, centerX, translateX.get(), ratio));
      translateY.set(zoomAbout(event.focalY, centerY, translateY.get(), ratio));
      scale.set(next);
    })
    .onEnd(() => {
      if (phase.get() === PHASE_OPEN) settle();
    })
    .onFinalize(() => {
      pinching.set(false);
    });

  // One gesture for both jobs: at rest a drag carries the image away to
  // dismiss, zoomed in it pans. Two pointers stay allowed so a pinch can also
  // move the image.
  const pan = Gesture.Pan()
    .minDistance(8)
    .maxPointers(2)
    .averageTouches(true)
    .onChange((event) => {
      if (phase.get() !== PHASE_OPEN) return;
      translateX.set(translateX.get() + event.changeX);
      translateY.set(translateY.get() + event.changeY);
    })
    .onEnd((event) => {
      if (phase.get() !== PHASE_OPEN || pinching.get()) return;
      if (
        scale.get() <= ARTWORK_VIEWER_ZOOMED_THRESHOLD &&
        shouldDismissDrag(translateY.get(), event.velocityY, windowHeight)
      ) {
        dismiss();
        return;
      }
      settle();
    });

  const doubleTap = Gesture.Tap()
    .numberOfTaps(2)
    .maxDelay(220)
    .onEnd((event, success) => {
      if (!success || phase.get() !== PHASE_OPEN) return;
      const current = scale.get();
      if (current > ARTWORK_VIEWER_ZOOMED_THRESHOLD) {
        scale.set(withTiming(1, motion.snap));
        translateX.set(withTiming(0, motion.snap));
        translateY.set(withTiming(0, motion.snap));
        return;
      }
      const ratio = ARTWORK_VIEWER_DOUBLE_TAP_ZOOM / current;
      scale.set(withTiming(ARTWORK_VIEWER_DOUBLE_TAP_ZOOM, motion.snap));
      translateX.set(
        withTiming(
          clampPan(
            zoomAbout(event.x, centerX, translateX.get(), ratio),
            target.x, target.width, ARTWORK_VIEWER_DOUBLE_TAP_ZOOM, windowWidth
          ),
          motion.snap
        )
      );
      translateY.set(
        withTiming(
          clampPan(
            zoomAbout(event.y, centerY, translateY.get(), ratio),
            target.y, target.height, ARTWORK_VIEWER_DOUBLE_TAP_ZOOM, windowHeight
          ),
          motion.snap
        )
      );
    });

  const singleTap = Gesture.Tap()
    .maxDuration(250)
    .onEnd((_event, success) => {
      if (success) dismiss();
    });

  const gesture = Gesture.Race(
    Gesture.Simultaneous(pinch, pan),
    Gesture.Exclusive(doubleTap, singleTap)
  );

  const backdropStyle = useAnimatedStyle(() => {
    const drag = getDragProgress(
      translateX.get(), translateY.get(), scale.get(), windowHeight
    );
    return {
      opacity:
        BACKDROP_OPACITY * progress.get() * visibility.get() * (1 - DRAG_BACKDROP_FADE * drag),
    };
  });
  const zoomStyle = useAnimatedStyle(() => {
    const drag = getDragProgress(
      translateX.get(), translateY.get(), scale.get(), windowHeight
    );
    return {
      opacity: visibility.get(),
      transform: [
        { translateX: translateX.get() },
        { translateY: translateY.get() },
        { scale: scale.get() * (1 - DRAG_SHRINK * drag) },
      ],
    };
  });
  const frameStyle = useAnimatedStyle(() => {
    const travel = getArtworkTravel(origin, target, progress.get());
    return {
      borderRadius: travel.radius,
      transform: [
        { translateX: travel.translateX },
        { translateY: travel.translateY },
        { scaleX: travel.scaleX },
        { scaleY: travel.scaleY },
      ],
    };
  });
  const imageStyle = useAnimatedStyle(() => {
    const travel = getArtworkTravel(origin, target, progress.get());
    return {
      transform: [{ scaleX: travel.imageScaleX }, { scaleY: travel.imageScaleY }],
    };
  });

  const requestClose = () => {
    runOnUI(dismiss)();
  };
  const onImageLoad = (event: ImageLoadEventData) => {
    const next = normalizeArtworkAspect(event.source.width, event.source.height);
    setAspect((current) => current ?? next);
  };

  const imageWidth = target.width * ARTWORK_VIEWER_OVERSAMPLE;
  const imageHeight = target.height * ARTWORK_VIEWER_OVERSAMPLE;

  return (
    <Modal
      visible
      transparent
      animationType="none"
      statusBarTranslucent
      navigationBarTranslucent
      onRequestClose={requestClose}
    >
      <GestureHandlerRootView style={styles.root}>
        <GestureDetector gesture={gesture}>
          <View style={styles.root} accessibilityViewIsModal>
            <Animated.View style={[StyleSheet.absoluteFill, styles.backdrop, backdropStyle]} />
            <Animated.View
              style={[
                styles.zoom,
                { left: target.x, top: target.y, width: target.width, height: target.height },
                zoomStyle,
              ]}
            >
              <Animated.View
                style={[
                  StyleSheet.absoluteFill,
                  styles.frame,
                  { backgroundColor: colors.bgTertiary },
                  frameStyle,
                ]}
              >
                <Animated.View
                  style={[
                    styles.image,
                    {
                      left: (target.width - imageWidth) / 2,
                      top: (target.height - imageHeight) / 2,
                      width: imageWidth,
                      height: imageHeight,
                    },
                    imageStyle,
                  ]}
                >
                  <Image
                    source={{ uri }}
                    style={StyleSheet.absoluteFill}
                    contentFit="cover"
                    transition={null}
                    priority="high"
                    onLoad={onImageLoad}
                    onError={requestClose}
                    accessibilityRole="image"
                    accessibilityLabel={`${label} artwork`}
                  />
                </Animated.View>
              </Animated.View>
            </Animated.View>
          </View>
        </GestureDetector>
      </GestureHandlerRootView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  backdrop: {
    backgroundColor: '#000000',
  },
  zoom: {
    position: 'absolute',
  },
  frame: {
    overflow: 'hidden',
  },
  image: {
    position: 'absolute',
  },
});

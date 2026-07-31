/* eslint-disable react-hooks/immutability, react-hooks/refs -- Reanimated gesture state and async transition refs are intentionally mutable. */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Pressable,
  type LayoutChangeEvent,
  type StyleProp,
  type ViewStyle
} from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  cancelAnimation,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { usePlayerOnScreen, usePlayerUiStore } from '@/stores/playerUiStore';
import { Text } from './Text';
import { AstraLogo } from './AstraLogo';
import { MiniPlayerScrim } from './MiniPlayerScrim';
import { SpectrumCurve } from './SpectrumCurve';
import {
  layout,
  radius,
  spacing,
} from '@/theme';
import { createThemedStyles, useColors } from '@/theme/themed';
import { useRipple } from '@/theme/ripple';
import { motion } from '@/theme/motion';
import { usePlayerStore } from '@/stores/playerStore';
import { useDesktopRemoteStore } from '@/stores/desktopRemoteStore';
import { usePlaybackTargetStore } from '@/stores/playbackTargetStore';
import { skipToNext, skipToPrevious, togglePlay } from '@/audio/playbackController';
import { markNowPlayingTrackTransitionDirection } from '@/stores/nowPlayingTrackTransitionStore';
import { useScopeActive } from '@/scope/scopeStore';
import {
  RAIL_MINI_TOP_MARGIN,
  type RailMiniPlayerLayout,
} from '@/navigation/shellLayout';
import { artworkThumbFromSource } from '@/library/artwork';
import { useAnimatedPlaybackProgress } from '@/audio/useAnimatedPlaybackProgress';
import { useAppForeground } from '@/lib/useAppForeground';
import { playHaptic } from '@/lib/haptics';
import { PlaybackTargetPicker } from './PlaybackTargetPicker';
import {
  getDesktopPlaybackPresentation,
  getEffectivePlaybackPresentation,
  getPhonePlaybackPresentation,
  type PlaybackPresentation,
} from '@/playback/playbackTargetPresentation';
import {
  miniPlayerSwipeDistance,
  resolveMiniPlayerSwipe,
  type MiniPlayerSwipeDirection,
} from './miniPlayerSwipe';

// The theme already declared this height and the component had drifted off it.
// Artwork is the height minus a uniform 8dp inset, matching the row's
// horizontal padding — the whole pill on one spacing step.
const PILL_HEIGHT = layout.miniPlayerHeight;
const ART = PILL_HEIGHT - spacing.sm * 2;
const CONTROL = 40;
const CURVE_POINTS = 64;
const SWIPE_ACTIVE_OFFSET_X = 10;
const SWIPE_FAIL_OFFSET_Y = 20;
const SWIPE_RESPONSE_TIMEOUT_MS = 1500;
const COMMITTED_MEDIA_OPACITY = 0.18;

interface MiniPlayerProps {
  /** 'pill' floats above the bottom tabs; 'rail' docks at the foot of the
   * landscape navigation rail, where there is ~88dp of width to work with. */
  variant?: 'pill' | 'rail';
  /** Required for the rail variant; sizes come from `getShellLayout`. */
  railLayout?: RailMiniPlayerLayout;
}

interface MiniPlayerMediaPresentation {
  key: string;
  title: string;
  subtitle: string;
  artworkUri: string | null;
}

interface PendingMiniPlayerSwipe {
  id: number;
  direction: MiniPlayerSwipeDirection;
  target: PlaybackPresentation['target'];
  trackKey: string | null;
  mediaWidth: number;
  timeout: ReturnType<typeof setTimeout>;
}

function sameMiniPlayerMedia(
  left: MiniPlayerMediaPresentation,
  right: MiniPlayerMediaPresentation
): boolean {
  return left.key === right.key &&
    left.title === right.title &&
    left.subtitle === right.subtitle &&
    left.artworkUri === right.artworkUri;
}

function MiniProgress({
  currentTime,
  duration,
  isPlaying,
  active,
  trackKey,
  trackStyle,
}: {
  currentTime: number;
  duration: number;
  isPlaying: boolean;
  active: boolean;
  trackKey: string | null;
  /** Overrides the pill's bottom-pinned track; the rail stacks it in flow. */
  trackStyle?: StyleProp<ViewStyle>;
}) {
  const styles = useStyles();
  const progress = useAnimatedPlaybackProgress({
    currentTime,
    duration,
    isPlaying,
    active,
    trackKey,
  });
  const progressStyle = useAnimatedStyle(() => ({
    transform: [{ scaleX: progress.value }],
  }));
  return (
    <View style={trackStyle ?? styles.progressTrack}>
      <Animated.View style={[styles.progressFill, progressStyle]} />
    </View>
  );
}

/** Phone-target progress: subscribes here so the 2Hz tick skips the whole pill. */
function PhoneMiniProgress({
  isPlaying,
  active,
  trackStyle,
}: {
  isPlaying: boolean;
  active: boolean;
  trackStyle?: StyleProp<ViewStyle>;
}) {
  const currentTime = usePlayerStore((s) => s.currentTime);
  const duration = usePlayerStore((s) => s.duration);
  const trackKey = usePlayerStore((s) => s.currentTrack?.path ?? null);
  return (
    <MiniProgress
      currentTime={currentTime}
      duration={duration}
      isPlaying={isPlaying}
      active={active}
      trackKey={trackKey}
      trackStyle={trackStyle}
    />
  );
}

/**
 * Persistent floating mini-player (M3 redesign): a rounded pill above the tab
 * bar with the live filled-line spectrum drifting behind the metadata. Tapping
 * opens the full now-playing screen.
 */
export function MiniPlayer({ variant = 'pill', railLayout }: MiniPlayerProps = {}) {
  const styles = useStyles();
  const colors = useColors();
  const ripple = useRipple();
  const playerOpen = usePlayerOnScreen();
  const selectedTarget = usePlaybackTargetStore((s) => s.target);
  const track = usePlayerStore((s) => s.currentTrack);
  const playbackState = usePlayerStore((s) => s.playbackState);
  const desktopConnection = useDesktopRemoteStore((s) => s.connection);
  const desktopConnectionState = useDesktopRemoteStore((s) => s.connectionState);
  const desktopSnapshot = useDesktopRemoteStore((s) => s.snapshot);
  const sendDesktopControl = useDesktopRemoteStore((s) => s.sendControl);
  const connectDesktop = useDesktopRemoteStore((s) => s.connect);

  const scopeActive = useScopeActive();
  const foreground = useAppForeground();
  const [pillWidth, setPillWidth] = useState(0);
  const [targetPickerOpen, setTargetPickerOpen] = useState(false);

  const phonePresentation = getPhonePlaybackPresentation({
    track,
    playbackState,
  });
  const desktopPresentation = getDesktopPlaybackPresentation({
    connection: desktopConnection,
    connectionState: desktopConnectionState,
    snapshot: desktopSnapshot,
  });
  const presentation = getEffectivePlaybackPresentation({
    selectedTarget,
    phone: phonePresentation,
    desktop: desktopPresentation,
  });

  const liveMediaKey = `${presentation.target}:${presentation.trackKey ?? 'none'}`;
  const liveMedia = useMemo<MiniPlayerMediaPresentation>(
    () => ({
      key: liveMediaKey,
      title: presentation.title,
      subtitle: presentation.subtitle,
      artworkUri: presentation.artworkUri,
    }),
    [
      liveMediaKey,
      presentation.artworkUri,
      presentation.subtitle,
      presentation.title,
    ]
  );
  const [displayedMedia, setDisplayedMedia] = useState(liveMedia);
  const [mediaWidth, setMediaWidth] = useState(0);
  const [transitionPending, setTransitionPending] = useState(false);
  const mediaTranslateX = useSharedValue(0);
  const mediaOpacity = useSharedValue(1);
  const cueSide = useSharedValue(0);
  const cueOpacity = useSharedValue(0);
  const armed = useSharedValue(false);
  const transitionOnUi = useSharedValue(false);
  const pendingSwipeRef = useRef<PendingMiniPlayerSwipe | null>(null);
  const swipeIdRef = useRef(0);
  const incomingDirectionRef = useRef<MiniPlayerSwipeDirection | null>(null);

  const rejectPendingSwipe = useCallback((id: number, haptic = true) => {
    const pending = pendingSwipeRef.current;
    if (!pending || pending.id !== id) return;
    clearTimeout(pending.timeout);
    pendingSwipeRef.current = null;
    incomingDirectionRef.current = null;
    transitionOnUi.value = false;
    armed.value = false;
    setTransitionPending(false);
    mediaTranslateX.value = withTiming(0, motion.quick);
    mediaOpacity.value = withTiming(1, motion.quick);
    cueOpacity.value = withTiming(0, motion.quick);
    if (haptic) playHaptic('reject');
  }, [armed, cueOpacity, mediaOpacity, mediaTranslateX, transitionOnUi]);

  const completePendingSwipe = useCallback((
    id: number,
    nextMedia: MiniPlayerMediaPresentation
  ) => {
    const pending = pendingSwipeRef.current;
    if (!pending || pending.id !== id) return;
    clearTimeout(pending.timeout);
    pendingSwipeRef.current = null;
    transitionOnUi.value = false;
    armed.value = false;
    setTransitionPending(false);
    incomingDirectionRef.current = pending.direction;
    mediaTranslateX.value = pending.direction === 'next'
      ? pending.mediaWidth / 2
      : -pending.mediaWidth / 2;
    mediaOpacity.value = COMMITTED_MEDIA_OPACITY;
    cueOpacity.value = withTiming(0, motion.quick);
    setDisplayedMedia(nextMedia);
    playHaptic('confirm');
  }, [armed, cueOpacity, mediaOpacity, mediaTranslateX, transitionOnUi]);

  const dispatchPendingSwipe = useCallback((id: number) => {
    const pending = pendingSwipeRef.current;
    if (!pending || pending.id !== id) return;
    if (pending.target === 'desktop') {
      markNowPlayingTrackTransitionDirection(
        pending.direction,
        pending.target,
      );
    }
    const command = pending.target === 'desktop'
      ? sendDesktopControl(pending.direction === 'next' ? 'next' : 'previous')
      : pending.direction === 'next'
        ? skipToNext()
        : skipToPrevious();
    void command.catch(() => rejectPendingSwipe(id));
  }, [rejectPendingSwipe, sendDesktopControl]);

  const beginPendingSwipe = useCallback((direction: MiniPlayerSwipeDirection) => {
    if (pendingSwipeRef.current || mediaWidth <= 0 || !presentation.hasTrack) {
      transitionOnUi.value = false;
      armed.value = false;
      mediaTranslateX.value = withTiming(0, motion.quick);
      mediaOpacity.value = withTiming(1, motion.quick);
      cueOpacity.value = withTiming(0, motion.quick);
      playHaptic('reject');
      return;
    }
    const id = ++swipeIdRef.current;
    const timeout = setTimeout(
      () => rejectPendingSwipe(id),
      motion.quick.duration + SWIPE_RESPONSE_TIMEOUT_MS
    );
    pendingSwipeRef.current = {
      id,
      direction,
      target: presentation.target,
      trackKey: presentation.trackKey,
      mediaWidth,
      timeout,
    };
    transitionOnUi.value = true;
    setTransitionPending(true);
    setDisplayedMedia((current) => sameMiniPlayerMedia(current, liveMedia) ? current : liveMedia);
    const exitX = direction === 'next' ? -mediaWidth / 2 : mediaWidth / 2;
    cueSide.value = direction === 'next' ? -1 : 1;
    cueOpacity.value = withTiming(1, motion.quick);
    mediaOpacity.value = withTiming(COMMITTED_MEDIA_OPACITY, motion.quick);
    mediaTranslateX.value = withTiming(exitX, motion.quick, (finished) => {
      if (finished) runOnJS(dispatchPendingSwipe)(id);
      else runOnJS(rejectPendingSwipe)(id);
    });
  }, [
    armed,
    cueOpacity,
    cueSide,
    dispatchPendingSwipe,
    liveMedia,
    mediaOpacity,
    mediaTranslateX,
    mediaWidth,
    presentation.hasTrack,
    presentation.target,
    presentation.trackKey,
    rejectPendingSwipe,
    transitionOnUi,
  ]);

  useEffect(() => {
    if (pendingSwipeRef.current) return;
    setDisplayedMedia((current) => sameMiniPlayerMedia(current, liveMedia) ? current : liveMedia);
  }, [liveMedia]);

  useEffect(() => {
    const pending = pendingSwipeRef.current;
    if (!pending) return;
    if (presentation.target !== pending.target) {
      rejectPendingSwipe(pending.id, false);
      return;
    }
    if (!presentation.visible || !presentation.hasTrack) {
      rejectPendingSwipe(pending.id);
      return;
    }
    if (presentation.trackKey !== pending.trackKey) {
      completePendingSwipe(pending.id, liveMedia);
    }
  }, [
    completePendingSwipe,
    liveMedia,
    presentation.hasTrack,
    presentation.target,
    presentation.trackKey,
    presentation.visible,
    rejectPendingSwipe,
  ]);

  useLayoutEffect(() => {
    if (!incomingDirectionRef.current) return;
    incomingDirectionRef.current = null;
    mediaTranslateX.value = withTiming(0, motion.snap);
    mediaOpacity.value = withTiming(1, motion.snap);
  }, [displayedMedia.key, mediaOpacity, mediaTranslateX]);

  useEffect(() => () => {
    const pending = pendingSwipeRef.current;
    if (pending) clearTimeout(pending.timeout);
    pendingSwipeRef.current = null;
    cancelAnimation(mediaTranslateX);
    cancelAnimation(mediaOpacity);
    cancelAnimation(cueOpacity);
  }, [cueOpacity, mediaOpacity, mediaTranslateX]);

  const mediaStyle = useAnimatedStyle(() => ({
    opacity: mediaOpacity.value,
    transform: [{ translateX: mediaTranslateX.value }],
  }));
  const previousCueStyle = useAnimatedStyle(() => ({
    opacity: cueSide.value > 0 ? cueOpacity.value : 0,
    transform: [{ scale: 0.85 + cueOpacity.value * 0.15 }],
  }));
  const nextCueStyle = useAnimatedStyle(() => ({
    opacity: cueSide.value < 0 ? cueOpacity.value : 0,
    transform: [{ scale: 0.85 + cueOpacity.value * 0.15 }],
  }));
  const swipeGesture = useMemo(
    () => Gesture.Pan()
      .enabled(presentation.hasTrack && mediaWidth > 0 && !transitionPending)
      .activeOffsetX([-SWIPE_ACTIVE_OFFSET_X, SWIPE_ACTIVE_OFFSET_X])
      .failOffsetY([-SWIPE_FAIL_OFFSET_Y, SWIPE_FAIL_OFFSET_Y])
      .onBegin(() => {
        cancelAnimation(mediaTranslateX);
        cancelAnimation(mediaOpacity);
        cancelAnimation(cueOpacity);
      })
      .onUpdate((event) => {
        const maxTranslation = mediaWidth / 2;
        const translation = Math.max(
          -maxTranslation,
          Math.min(maxTranslation, event.translationX)
        );
        const threshold = Math.max(1, miniPlayerSwipeDistance(mediaWidth));
        const progress = Math.min(1, Math.abs(translation) / threshold);
        mediaTranslateX.value = translation;
        mediaOpacity.value = 1 - progress * 0.15;
        cueSide.value = translation > 0 ? 1 : translation < 0 ? -1 : 0;
        cueOpacity.value = progress;
        const nowArmed = Math.abs(translation) >= threshold;
        if (nowArmed !== armed.value) {
          armed.value = nowArmed;
          runOnJS(playHaptic)(nowArmed ? 'threshold' : 'thresholdExit');
        }
      })
      .onEnd((event) => {
        const direction = resolveMiniPlayerSwipe({
          translationX: event.translationX,
          velocityX: event.velocityX,
          mediaWidth,
        });
        if (!direction) return;
        armed.value = false;
        transitionOnUi.value = true;
        runOnJS(beginPendingSwipe)(direction);
      })
      .onFinalize(() => {
        if (transitionOnUi.value) return;
        if (armed.value) runOnJS(playHaptic)('thresholdExit');
        armed.value = false;
        mediaTranslateX.value = withTiming(0, motion.quick);
        mediaOpacity.value = withTiming(1, motion.quick);
        cueOpacity.value = withTiming(0, motion.quick);
      }),
    [
      armed,
      beginPendingSwipe,
      cueOpacity,
      cueSide,
      mediaOpacity,
      mediaTranslateX,
      mediaWidth,
      presentation.hasTrack,
      transitionOnUi,
      transitionPending,
    ]
  );

  if (!presentation.visible) return null;

  const isDesktop = presentation.target === 'desktop';
  const isPlaying = presentation.playbackState === 'playing';
  const isLoading = presentation.playbackState === 'loading';
  // The pill sits underneath the now-playing overlay; don't burn a second
  // live-scope frame loop while it's fully occluded.
  const liveScopeActive = scopeActive && foreground && !isDesktop && !playerOpen;

  const onLayout = (e: LayoutChangeEvent) => setPillWidth(e.nativeEvent.layout.width);
  const onTogglePlay = () => {
    if (isDesktop) {
      if (!desktopConnection || desktopConnectionState === 'error') {
        void connectDesktop();
        return;
      }
      void sendDesktopControl(isPlaying ? 'pause' : 'play');
      return;
    }
    void togglePlay();
  };
  const onSkipNext = () => {
    if (isDesktop) {
      markNowPlayingTrackTransitionDirection('next', 'desktop');
      void sendDesktopControl('next');
      return;
    }
    void skipToNext();
  };
  const onMediaLayout = (e: LayoutChangeEvent) => {
    setMediaWidth(e.nativeEvent.layout.width);
  };

  if (variant === 'rail' && railLayout) {
    const { artSize, titleLineHeight, controlSize, gap, blockHeight } = railLayout;
    return (
      <>
        <View style={[styles.railBlock, { height: blockHeight - RAIL_MINI_TOP_MARGIN }]}>
          <Pressable
            android_ripple={ripple.bounded}
            style={styles.railTap}
            onPress={() => usePlayerUiStore.getState().openPlayer()}
            accessibilityRole="button"
            accessibilityLabel={
              presentation.hasTrack
                ? `Now playing: ${displayedMedia.title}. Open player`
                : 'Open player'
            }
          >
            {artSize > 0 ? (
              <View style={[styles.railArt, { width: artSize, height: artSize }]}>
                {displayedMedia.artworkUri ? (
                  <Image
                    source={{
                      uri:
                        artworkThumbFromSource(displayedMedia.artworkUri) ??
                        displayedMedia.artworkUri,
                    }}
                    style={styles.artImage}
                    contentFit="cover"
                  />
                ) : (
                  <AstraLogo size={Math.round(artSize * 0.4)} />
                )}
              </View>
            ) : null}
            {artSize > 0 && presentation.hasTrack ? (
              isDesktop ? (
                <MiniProgress
                  currentTime={presentation.currentTime}
                  duration={presentation.duration}
                  isPlaying={isPlaying}
                  active={!playerOpen}
                  trackKey={presentation.trackKey}
                  trackStyle={[styles.railProgress, { width: artSize, marginTop: gap }]}
                />
              ) : (
                <PhoneMiniProgress
                  isPlaying={isPlaying}
                  active={!playerOpen}
                  trackStyle={[styles.railProgress, { width: artSize, marginTop: gap }]}
                />
              )
            ) : null}
            {titleLineHeight > 0 ? (
              <Text
                variant="label"
                numberOfLines={1}
                style={[styles.railTitle, { height: titleLineHeight, marginTop: gap }]}
              >
                {displayedMedia.title}
              </Text>
            ) : null}
          </Pressable>
          <View style={[styles.railControls, { height: controlSize, marginTop: gap }]}>
            <Pressable
              hitSlop={8}
              android_ripple={ripple.icon(20)}
              onPress={onTogglePlay}
              style={[styles.control, { width: controlSize, height: controlSize }]}
              accessibilityLabel={isPlaying ? 'Pause' : 'Play'}
            >
              <Ionicons
                name={isLoading ? 'ellipsis-horizontal' : isPlaying ? 'pause' : 'play'}
                size={22}
                color={colors.accent}
              />
            </Pressable>
            <Pressable
              hitSlop={8}
              android_ripple={ripple.icon(20)}
              onPress={onSkipNext}
              style={[styles.control, { width: controlSize, height: controlSize }]}
              accessibilityLabel="Next"
            >
              <Ionicons name="play-skip-forward" size={20} color={colors.textSecondary} />
            </Pressable>
          </View>
        </View>
        <PlaybackTargetPicker
          visible={targetPickerOpen}
          onClose={() => setTargetPickerOpen(false)}
        />
      </>
    );
  }

  return (
    <>
      {/* Rendered from here rather than from TabBar so it's gated by the same
          `presentation.visible` early return the pill is — a scrim with no pill
          under it would just be an unexplained dark band. Absolute, so it fills
          TabBar's `floatingPlayer` box; first in tree order so it paints behind
          the pill. */}
      <MiniPlayerScrim />
      <GestureDetector gesture={swipeGesture}>
        <Animated.View style={styles.pill} onLayout={onLayout}>
          <Pressable
            android_ripple={ripple.bounded}
            style={styles.pillPressable}
            onPress={() => usePlayerUiStore.getState().openPlayer()}
          >
            {liveScopeActive && pillWidth > 0 && (
              <View pointerEvents="none" style={styles.spectrum}>
                <SpectrumCurve
                  active={liveScopeActive}
                  pointCount={CURVE_POINTS}
                  dbMin={-84}
                  dbMax={-20}
                  width={pillWidth}
                  height={PILL_HEIGHT}
                  lineWidth={1.25}
                  lineOpacity={0.38}
                  fillOpacity={0.3}
                  glow
                  glowOpacity={0.06}
                />
              </View>
            )}
            {liveScopeActive && pillWidth > 0 && <View pointerEvents="none" style={styles.spectrumVeil} />}

            <View style={styles.row}>
              <View style={styles.mediaFrame}>
                <Animated.View
                  pointerEvents="none"
                  style={[styles.swipeCue, styles.previousCue, previousCueStyle]}
                >
                  <Ionicons name="play-skip-back" size={20} color={colors.accent} />
                </Animated.View>
                <Animated.View
                  pointerEvents="none"
                  style={[styles.swipeCue, styles.nextCue, nextCueStyle]}
                >
                  <Ionicons name="play-skip-forward" size={20} color={colors.accent} />
                </Animated.View>
                <Animated.View style={[styles.media, mediaStyle]} onLayout={onMediaLayout}>
                  <View style={styles.art}>
                    {displayedMedia.artworkUri ? (
                      <Image
                        source={{
                          uri: artworkThumbFromSource(displayedMedia.artworkUri) ?? displayedMedia.artworkUri,
                        }}
                        style={styles.artImage}
                        contentFit="cover"
                      />
                    ) : (
                      <AstraLogo size={24} />
                    )}
                  </View>

                  <View style={styles.meta}>
                    <Text variant="body" numberOfLines={1} style={styles.title}>
                      {displayedMedia.title}
                    </Text>
                    <Text variant="label" numberOfLines={1}>
                      {displayedMedia.subtitle}
                    </Text>
                  </View>
                </Animated.View>
              </View>

              {isDesktop ? (
                <Pressable
                  hitSlop={10}
                  android_ripple={ripple.icon(22)}
                  onPress={() => setTargetPickerOpen(true)}
                  style={styles.control}
                  accessibilityLabel="Choose output device"
                >
                  <Ionicons name="desktop-outline" size={21} color={colors.textSecondary} />
                </Pressable>
              ) : null}
              <Pressable hitSlop={10} android_ripple={ripple.icon(22)} onPress={onTogglePlay} style={styles.control}>
                <Ionicons
                  name={isLoading ? 'ellipsis-horizontal' : isPlaying ? 'pause' : 'play'}
                  size={24}
                  color={colors.accent}
                />
              </Pressable>
              {/* Secondary, so play/pause stays the brightest thing in the
                  pill. A filled accent disc would read better on a flat
                  surface, but here it would punch a hole through the live
                  spectrum drawing behind all of this. */}
              <Pressable hitSlop={10} android_ripple={ripple.icon(22)} onPress={onSkipNext} style={styles.control}>
                <Ionicons name="play-skip-forward" size={22} color={colors.textSecondary} />
              </Pressable>
            </View>

            {presentation.hasTrack ? (
              isDesktop ? (
                <MiniProgress
                  currentTime={presentation.currentTime}
                  duration={presentation.duration}
                  isPlaying={isPlaying}
                  active={!playerOpen}
                  trackKey={presentation.trackKey}
                />
              ) : (
                <PhoneMiniProgress isPlaying={isPlaying} active={!playerOpen} />
              )
            ) : null}
          </Pressable>
        </Animated.View>
      </GestureDetector>
      <PlaybackTargetPicker
        visible={targetPickerOpen}
        onClose={() => setTargetPickerOpen(false)}
      />
    </>
  );
}

const useStyles = createThemedStyles((colors) => ({
  pill: {
    height: PILL_HEIGHT,
    // Matches the screens' content gutter (Screen's paddingHorizontal), so the
    // pill's edges line up with the grid it floats over instead of running
    // 4dp wider than it.
    marginHorizontal: spacing.lg,
    marginTop: spacing.sm,
    marginBottom: spacing.sm,
    borderRadius: radius.lg,
    backgroundColor: colors.bgTertiary,
    // A full 1dp at the stronger alpha, not a hairline at the ambient one: this
    // rim is the pill's only hard edge against whatever content is underneath,
    // and `glassBorder` at hairline width is invisible over album art.
    borderColor: colors.glassBorderStrong,
    borderWidth: 1,
    overflow: 'hidden',
    justifyContent: 'center',
    // It does float over the list, so it should look like it rather than
    // sitting flush on the tab bar's surface. Reads only where it falls on
    // bright artwork — the rim is what carries the edge everywhere else.
    shadowColor: '#000',
    shadowOpacity: 0.34,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 10,
  },
  pillPressable: {
    flex: 1,
    justifyContent: 'center',
  },
  spectrum: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  spectrumVeil: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: colors.overlayFaint,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.sm,
    gap: spacing.sm,
  },
  mediaFrame: {
    flex: 1,
    height: ART,
    justifyContent: 'center',
    overflow: 'hidden',
  },
  media: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  swipeCue: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    justifyContent: 'center',
  },
  previousCue: {
    left: spacing.sm,
  },
  nextCue: {
    right: spacing.sm,
  },
  art: {
    width: ART,
    height: ART,
    borderRadius: radius.sm,
    backgroundColor: colors.bgSecondary,
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
  },
  title: {
    fontSize: 15,
  },
  control: {
    width: CONTROL,
    height: CONTROL,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Rail variant: a compact stack docked at the foot of the landscape rail.
  railBlock: {
    alignItems: 'center',
  },
  railTap: {
    alignItems: 'center',
    alignSelf: 'stretch',
  },
  railArt: {
    borderRadius: radius.md,
    overflow: 'hidden',
    backgroundColor: colors.bgTertiary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  railProgress: {
    height: 2,
    borderRadius: 999,
    overflow: 'hidden',
    backgroundColor: colors.glassBorder,
  },
  railTitle: {
    alignSelf: 'stretch',
    textAlign: 'center',
    color: colors.textPrimary,
  },
  railControls: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  progressTrack: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: 2,
    backgroundColor: colors.glassBorder,
  },
  progressFill: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    transformOrigin: 'left center',
    height: 2,
    backgroundColor: colors.accent,
  },
}));

export default MiniPlayer;

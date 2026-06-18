import { useState } from 'react';
import { View, Pressable, StyleSheet, useWindowDimensions } from 'react-native';
import { Image } from 'expo-image';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  SlideInDown,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { Text } from '@/components/Text';
import { AstraLogo } from '@/components/AstraLogo';
import { FormatBadges } from '@/components/FormatBadge';
import { WaveformSeekBar } from '@/components/WaveformSeekBar';
import { Visualizer } from '@/components/Visualizer';
import { QueueTray } from '@/components/queue/QueueTray';
import { colors, radius, spacing } from '@/theme';
import { motion } from '@/theme/motion';
import { usePlayerStore } from '@/stores/playerStore';
import { usePlaylistStore } from '@/stores/playlistStore';
import { useSettingsStore } from '@/stores/settingsStore';
import {
  cycleRepeat,
  seekTo,
  skipToNext,
  skipToPrevious,
  togglePlay,
  toggleShuffle,
} from '@/audio/playbackController';

const DISMISS_DISTANCE = 140;
const DISMISS_VELOCITY = 1000;

const MAX_CONTENT_WIDTH = 408;
const CONTENT_SIDE_PADDING = spacing.lg;
const NARROW_CONTENT_SIDE_PADDING = spacing.md;
const MEDIA_AREA_MIN = 220;
const MEDIA_AREA_MAX = 360;
const ART_SIZE_MAX = 340;
const VISUALIZER_ART_SCALE = 0.8;
const VISUALIZER_ART_SIZE_MIN = 176;
const VISUALIZER_WIDTH_MAX = 448;
const VISUALIZER_SIDE_PADDING = spacing.md;
const VISUALIZER_TOP_GAP = spacing.lg;
const VISUALIZER_BOTTOM_GAP = spacing.sm;
const VISUALIZER_HEIGHT_MIN = 84;
const VISUALIZER_HEIGHT_MAX = 108;
const VISUALIZER_HEIGHT_RATIO = 0.28;
const HEADER_HEIGHT = 32;
const CONTENT_TOP_PADDING = spacing.sm;
const CONTENT_BOTTOM_PADDING = spacing.lg;
const MEDIA_TOP_MARGIN = spacing.lg;
const VISUALIZER_MEDIA_BOTTOM_GAP = spacing.sm;
const MEDIA_BOTTOM_GAP = spacing.xl;
const TRACK_INFO_ESTIMATE = 96;
const WAVEFORM_HEIGHT = 58;
const WAVEFORM_TOUCH_PADDING = spacing.md;
const WAVEFORM_BLOCK_ESTIMATE = WAVEFORM_HEIGHT + WAVEFORM_TOUCH_PADDING * 2 + 24;
const PLAY_BUTTON_SIZE = 68;
const SKIP_ICON_SIZE = 32;
const PLAY_ICON_SIZE = 34;
const TRANSPORT_TOP_MARGIN = spacing.lg;
const SUB_BUTTON_SIZE = 40;
const SUB_ICON_SIZE = 20;
const SUB_TOP_MARGIN = spacing.lg;
const MIN_FLOATING_SPACE = spacing.sm;

interface NowPlayingLayout {
  contentPadding: number;
  contentWidth: number;
  artSize: number;
  scopeWidth: number;
  scopeHeight: number;
  visualizerTopGap: number;
  visualizerBottomGap: number;
  mediaTopMargin: number;
  mediaBottomGap: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function getScopeHeight(scopeWidth: number): number {
  return Math.round(
    clamp(scopeWidth * VISUALIZER_HEIGHT_RATIO, VISUALIZER_HEIGHT_MIN, VISUALIZER_HEIGHT_MAX)
  );
}

function getNowPlayingLayout(
  windowWidth: number,
  availableHeight: number,
  showVisualizer: boolean
): NowPlayingLayout {
  const contentPadding =
    windowWidth < 360 ? NARROW_CONTENT_SIDE_PADDING : CONTENT_SIDE_PADDING;
  const contentWidth = Math.max(0, Math.min(windowWidth - contentPadding * 2, MAX_CONTENT_WIDTH));
  const scopeWidth = Math.max(
    0,
    Math.min(windowWidth - VISUALIZER_SIDE_PADDING * 2, VISUALIZER_WIDTH_MAX)
  );
  const scopeHeight = getScopeHeight(scopeWidth);
  const mediaMax = Math.min(contentWidth, MEDIA_AREA_MAX);
  const mediaMin = Math.min(mediaMax, MEDIA_AREA_MIN);
  const mediaTopMargin = availableHeight < 680 ? spacing.md : MEDIA_TOP_MARGIN;
  const defaultMediaBottomGap = availableHeight < 680 ? spacing.lg : MEDIA_BOTTOM_GAP;
  const mediaBottomGap = showVisualizer ? VISUALIZER_MEDIA_BOTTOM_GAP : defaultMediaBottomGap;
  const fixedHeight =
    CONTENT_TOP_PADDING +
    CONTENT_BOTTOM_PADDING +
    HEADER_HEIGHT +
    mediaTopMargin +
    mediaBottomGap +
    TRACK_INFO_ESTIMATE +
    WAVEFORM_BLOCK_ESTIMATE +
    TRANSPORT_TOP_MARGIN +
    PLAY_BUTTON_SIZE +
    SUB_TOP_MARGIN +
    SUB_BUTTON_SIZE +
    MIN_FLOATING_SPACE;
  const heightBoundMedia = availableHeight - fixedHeight;
  const baseArtSize = Math.min(
    Math.round(clamp(heightBoundMedia, mediaMin, mediaMax)),
    ART_SIZE_MAX
  );
  const artSize = showVisualizer
    ? Math.round(
        clamp(
          baseArtSize * VISUALIZER_ART_SCALE,
          Math.min(VISUALIZER_ART_SIZE_MIN, mediaMax),
          mediaMax
        )
      )
    : baseArtSize;

  const visualizerTopGap = showVisualizer ? VISUALIZER_TOP_GAP : 0;
  const visualizerBottomGap = showVisualizer ? VISUALIZER_BOTTOM_GAP : 0;

  return {
    contentPadding,
    contentWidth,
    artSize,
    scopeWidth,
    scopeHeight,
    visualizerTopGap,
    visualizerBottomGap,
    mediaTopMargin,
    mediaBottomGap,
  };
}

export default function NowPlayingScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const [queueOpen, setQueueOpen] = useState(false);
  const scopeMode = useSettingsStore((s) => s.scopeMode);
  const scopeStageVisible = useSettingsStore((s) => s.scopeStageVisible);
  const setScopeStageVisible = useSettingsStore((s) => s.setScopeStageVisible);
  const track = usePlayerStore((s) => s.currentTrack);
  const playbackState = usePlayerStore((s) => s.playbackState);
  const currentTime = usePlayerStore((s) => s.currentTime);
  const duration = usePlayerStore((s) => s.duration);
  const shuffle = usePlayerStore((s) => s.shuffle);
  const repeat = usePlayerStore((s) => s.repeat);
  const isFavorite = usePlaylistStore((s) => (track ? s.favoritePaths.has(track.path) : false));
  const toggleFavorite = usePlaylistStore((s) => s.toggleFavorite);

  const isPlaying = playbackState === 'playing';
  const isLoading = playbackState === 'loading';
  const availableHeight = windowHeight - insets.top - insets.bottom;
  const layout = getNowPlayingLayout(windowWidth, availableHeight, scopeStageVisible);
  const source = track?.album?.trim() ? track.album : 'Library';

  // Swipe down to minimize. The stack transition is disabled for this route, so
  // the sheet owns one continuous enter/exit animation instead of handing off to
  // a second native modal animation after release.
  const translateY = useSharedValue(0);
  const dismiss = () => router.back();

  const dismissSheet = (velocity = 0) => {
    translateY.value = withSpring(
      windowHeight,
      {
        damping: 28,
        stiffness: 240,
        velocity,
        overshootClamping: true,
      },
      (finished) => {
        if (finished) runOnJS(dismiss)();
      }
    );
  };

  const pan = Gesture.Pan()
    .activeOffsetY(14) // engage only on a downward drag
    .failOffsetY(-14)
    .failOffsetX([-24, 24]) // let the horizontal seek drag through
    .onUpdate((e) => {
      translateY.value = e.translationY > 0 ? e.translationY : 0;
    })
    .onEnd((e) => {
      if (e.translationY > DISMISS_DISTANCE || e.velocityY > DISMISS_VELOCITY) {
        translateY.value = withSpring(
          windowHeight,
          {
            damping: 28,
            stiffness: 240,
            velocity: e.velocityY,
            overshootClamping: true,
          },
          (finished) => {
            if (finished) runOnJS(dismiss)();
          }
        );
      } else {
        translateY.value = withTiming(0, motion.snap);
      }
    });

  const contentStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }],
  }));

  return (
    <View style={styles.backdrop}>
      <GestureDetector gesture={pan}>
        <Animated.View
          entering={SlideInDown.duration(240)}
          style={[
            styles.content,
            contentStyle,
            {
              paddingHorizontal: layout.contentPadding,
              paddingTop: insets.top + CONTENT_TOP_PADDING,
              paddingBottom: insets.bottom + CONTENT_BOTTOM_PADDING,
            },
          ]}
        >
          <View style={[styles.shell, { width: layout.contentWidth }]}>
            <View style={styles.header}>
              <Pressable style={styles.headerBtn} onPress={() => dismissSheet()} hitSlop={12}>
                <Ionicons name="chevron-down" size={26} color={colors.textSecondary} />
              </Pressable>
              <View style={styles.headerMid}>
                <Text variant="caption" style={styles.eyebrow}>
                  PLAYING FROM
                </Text>
                <Text variant="label" numberOfLines={1} style={styles.source}>
                  {source}
                </Text>
              </View>
              <Pressable style={styles.headerBtn} hitSlop={12} accessibilityLabel="More options">
                <Ionicons name="ellipsis-vertical" size={20} color={colors.textSecondary} />
              </Pressable>
            </View>

            {track ? (
              <View style={styles.player}>
                <View
                  style={[
                    styles.middleStack,
                    {
                      marginTop: layout.mediaTopMargin,
                      marginBottom: layout.mediaBottomGap,
                    },
                  ]}
                >
                  <View
                    style={[
                      styles.artButton,
                      {
                        width: layout.artSize,
                        height: layout.artSize,
                      },
                    ]}
                  >
                    <View
                      style={[
                        styles.artCard,
                        {
                          width: layout.artSize,
                          height: layout.artSize,
                        },
                      ]}
                    >
                      {track.artworkData ? (
                        <Image
                          key={track.id}
                          source={{ uri: track.artworkData }}
                          style={styles.artImage}
                          contentFit="cover"
                        />
                      ) : (
                        <AstraLogo size={Math.round(layout.artSize * 0.4)} />
                      )}
                    </View>
                  </View>

                  {scopeStageVisible && (
                    <View
                      style={[
                        styles.scopeRail,
                        {
                          width: layout.scopeWidth,
                          height: layout.scopeHeight,
                          marginTop: layout.visualizerTopGap,
                          marginBottom: layout.visualizerBottomGap,
                        },
                      ]}
                    >
                      <Visualizer
                        width={layout.scopeWidth}
                        height={layout.scopeHeight}
                        interactive={false}
                        showChrome={false}
                        mode={scopeMode}
                        edgeFade
                      />
                      <Pressable
                        onPress={() =>
                          useSettingsStore
                            .getState()
                            .setScopeMode(scopeMode === 'spectrum' ? 'scope' : 'spectrum')
                        }
                        hitSlop={12}
                        style={styles.scopeSwap}
                        accessibilityRole="button"
                        accessibilityLabel={`Showing ${
                          scopeMode === 'spectrum' ? 'spectrum' : 'oscilloscope'
                        }. Tap to switch.`}
                      >
                        <Text variant="caption" style={styles.scopeSwapLabel}>
                          {scopeMode === 'spectrum' ? 'SPECTRUM' : 'SCOPE'}
                        </Text>
                        <Ionicons name="swap-horizontal" size={14} color={colors.textTertiary} />
                      </Pressable>
                    </View>
                  )}
                </View>

                <View style={styles.spacer} />

                <View style={styles.playerControls}>
                  <View style={styles.trackInfo}>
                    <View style={styles.trackTextStack}>
                      <Text variant="heading" numberOfLines={1} style={styles.trackTitle}>
                        {track.title}
                      </Text>
                      <View style={styles.trackMetaRow}>
                        <Text variant="body" numberOfLines={1} style={styles.artist}>
                          {track.artist}
                        </Text>
                        <View style={styles.badges}>
                          <FormatBadges track={track} />
                        </View>
                      </View>
                    </View>
                    <Pressable
                      hitSlop={10}
                      style={styles.inlineActionBtn}
                      onPress={() => void toggleFavorite(track)}
                      accessibilityLabel={isFavorite ? 'Remove from favorites' : 'Add to favorites'}
                      accessibilityState={{ selected: isFavorite }}
                    >
                      <Ionicons
                        name={isFavorite ? 'heart' : 'heart-outline'}
                        size={SUB_ICON_SIZE + 4}
                        color={isFavorite ? colors.accent : colors.textTertiary}
                      />
                    </Pressable>
                  </View>

                  <WaveformSeekBar
                    currentTime={currentTime}
                    duration={duration}
                    height={WAVEFORM_HEIGHT}
                    touchPadding={WAVEFORM_TOUCH_PADDING}
                    trackKey={track.id}
                    trackPath={track.path}
                    onSeek={(seconds) => void seekTo(seconds)}
                  />

                  <View style={styles.transport}>
                    <Pressable
                      hitSlop={10}
                      style={styles.transportSideBtn}
                      onPress={() => void toggleShuffle()}
                      accessibilityLabel="Shuffle"
                      accessibilityState={{ selected: shuffle }}
                    >
                      <Ionicons
                        name="shuffle"
                        size={SUB_ICON_SIZE + 2}
                        color={shuffle ? colors.accent : colors.textTertiary}
                      />
                    </Pressable>
                    <Pressable
                      onPress={skipToPrevious}
                      hitSlop={12}
                      style={styles.transportMainBtn}
                    >
                      <Ionicons
                        name="play-skip-back"
                        size={SKIP_ICON_SIZE}
                        color={colors.textPrimary}
                      />
                    </Pressable>
                    <Pressable onPress={togglePlay} hitSlop={12} style={styles.playButton}>
                      <Ionicons
                        name={isLoading ? 'ellipsis-horizontal' : isPlaying ? 'pause' : 'play'}
                        size={PLAY_ICON_SIZE}
                        color={colors.bgPrimary}
                      />
                    </Pressable>
                    <Pressable
                      onPress={skipToNext}
                      hitSlop={12}
                      style={styles.transportMainBtn}
                    >
                      <Ionicons
                        name="play-skip-forward"
                        size={SKIP_ICON_SIZE}
                        color={colors.textPrimary}
                      />
                    </Pressable>
                    <Pressable
                      hitSlop={10}
                      style={styles.transportSideBtn}
                      onPress={() => void cycleRepeat()}
                      accessibilityLabel="Repeat"
                      accessibilityState={{ selected: repeat !== 'none' }}
                    >
                      {repeat === 'one' ? (
                        <MaterialCommunityIcons
                          name="repeat-once"
                          size={SUB_ICON_SIZE + 2}
                          color={colors.accent}
                        />
                      ) : (
                        <Ionicons
                          name="repeat"
                          size={SUB_ICON_SIZE + 2}
                          color={repeat === 'all' ? colors.accent : colors.textTertiary}
                        />
                      )}
                    </Pressable>
                  </View>

                  <View style={styles.subRow}>
                    <Pressable
                      hitSlop={10}
                      style={styles.subBtn}
                      onPress={() => void setScopeStageVisible(!scopeStageVisible)}
                      accessibilityLabel={scopeStageVisible ? 'Hide visualizer' : 'Show visualizer'}
                      accessibilityState={{ selected: scopeStageVisible }}
                    >
                      <MaterialCommunityIcons
                        name="sine-wave"
                        size={SUB_ICON_SIZE + 2}
                        color={scopeStageVisible ? colors.accent : colors.textTertiary}
                      />
                    </Pressable>
                    <Pressable
                      hitSlop={10}
                      style={styles.subBtn}
                      onPress={() => setQueueOpen(true)}
                      accessibilityLabel="Queue"
                    >
                      <Ionicons
                        name="list-outline"
                        size={SUB_ICON_SIZE + 2}
                        color={colors.textTertiary}
                      />
                    </Pressable>
                  </View>
                </View>
              </View>
            ) : (
              <View style={styles.empty}>
                <Text variant="heading">Nothing playing</Text>
                <Text variant="body" color={colors.textSecondary} style={styles.centered}>
                  Start a track from Home.
                </Text>
              </View>
            )}
          </View>
        </Animated.View>
      </GestureDetector>
      {queueOpen && <QueueTray onClose={() => setQueueOpen(false)} />}
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  content: {
    flex: 1,
    backgroundColor: colors.bgPrimary,
    alignItems: 'center',
  },
  shell: {
    flex: 1,
  },
  header: {
    height: HEADER_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerBtn: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerMid: {
    flex: 1,
    alignItems: 'center',
  },
  eyebrow: {
    color: colors.textTertiary,
    letterSpacing: 1.5,
    fontSize: 10,
  },
  source: {
    color: colors.textSecondary,
    marginTop: 1,
  },
  player: {
    flex: 1,
  },
  middleStack: {
    width: '100%',
    alignItems: 'center',
  },
  artButton: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  artCard: {
    borderRadius: radius.lg,
    backgroundColor: colors.bgTertiary,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  scopeRail: {
    alignSelf: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  scopeSwap: {
    position: 'absolute',
    top: spacing.xs,
    right: spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  scopeSwapLabel: {
    color: colors.textTertiary,
    letterSpacing: 1.5,
    fontSize: 10,
  },
  artImage: {
    width: '100%',
    height: '100%',
  },
  trackInfo: {
    alignSelf: 'stretch',
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginBottom: spacing.md,
  },
  trackTextStack: {
    flex: 1,
    minWidth: 0,
    alignItems: 'flex-start',
  },
  trackTitle: {
    alignSelf: 'stretch',
    textAlign: 'left',
  },
  inlineActionBtn: {
    width: SUB_BUTTON_SIZE,
    height: SUB_BUTTON_SIZE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  trackMetaRow: {
    alignSelf: 'stretch',
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
  centered: {
    textAlign: 'center',
  },
  artist: {
    color: colors.accentText,
    flexShrink: 1,
    minWidth: 0,
  },
  badges: {
    flexShrink: 0,
  },
  spacer: {
    flex: 1,
    minHeight: MIN_FLOATING_SPACE,
  },
  playerControls: {
    width: '100%',
  },
  transport: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: TRANSPORT_TOP_MARGIN,
  },
  transportMainBtn: {
    width: 48,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  transportSideBtn: {
    width: 48,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  playButton: {
    width: PLAY_BUTTON_SIZE,
    height: PLAY_BUTTON_SIZE,
    borderRadius: radius.pill,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  subRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: spacing.lg,
    marginTop: SUB_TOP_MARGIN,
    paddingHorizontal: spacing.sm,
  },
  subBtn: {
    width: SUB_BUTTON_SIZE,
    height: SUB_BUTTON_SIZE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  empty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

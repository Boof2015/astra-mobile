import { useState } from 'react';
import { View, Pressable, StyleSheet, useWindowDimensions } from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  SlideInDown,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import { Text } from '@/components/Text';
import { AstraLogo } from '@/components/AstraLogo';
import { FormatBadges } from '@/components/FormatBadge';
import { WaveformSeekBar } from '@/components/WaveformSeekBar';
import { Visualizer } from '@/components/Visualizer';
import { colors, radius, spacing } from '@/theme';
import { usePlayerStore } from '@/stores/playerStore';
import { seekTo, skipToNext, skipToPrevious, togglePlay } from '@/audio/playbackController';

type IconName = keyof typeof Ionicons.glyphMap;

// Secondary controls are placeholders for now — laid out to settle the design.
const SUB_CONTROLS: { icon: IconName; label: string }[] = [
  { icon: 'shuffle', label: 'Shuffle' },
  { icon: 'heart-outline', label: 'Favorite' },
  { icon: 'list-outline', label: 'Queue' },
  { icon: 'repeat', label: 'Repeat' },
];

const DISMISS_DISTANCE = 140;
const DISMISS_VELOCITY = 1000;

const MAX_CONTENT_WIDTH = 408;
const CONTENT_SIDE_PADDING = spacing.lg;
const NARROW_CONTENT_SIDE_PADDING = spacing.md;
const MEDIA_AREA_MIN = 220;
const MEDIA_AREA_MAX = 360;
const ART_SIZE_MAX = 340;
const SCOPE_HEIGHT_MIN = 150;
const SCOPE_HEIGHT_MAX = 220;
const SCOPE_HEIGHT_RATIO = 9 / 16;
const HEADER_HEIGHT = 32;
const CONTENT_TOP_PADDING = spacing.sm;
const CONTENT_BOTTOM_PADDING = spacing.lg;
const MEDIA_TOP_MARGIN = spacing.lg;
const MEDIA_BOTTOM_GAP = spacing.xl;
const TRACK_INFO_ESTIMATE = 96;
const WAVEFORM_HEIGHT = 58;
const WAVEFORM_TOUCH_PADDING = spacing.md;
const WAVEFORM_BLOCK_ESTIMATE = WAVEFORM_HEIGHT + WAVEFORM_TOUCH_PADDING * 2 + 24;
const PLAY_BUTTON_SIZE = 68;
const SKIP_ICON_SIZE = 32;
const PLAY_ICON_SIZE = 34;
const TRANSPORT_GAP = spacing.xxl;
const TRANSPORT_TOP_MARGIN = spacing.lg;
const SUB_BUTTON_SIZE = 40;
const SUB_ICON_SIZE = 20;
const SUB_TOP_MARGIN = spacing.lg;
const MIN_FLOATING_SPACE = spacing.sm;
const SECONDARY_CONTROLS_MIN_HEIGHT = 660;

interface NowPlayingLayout {
  contentPadding: number;
  contentWidth: number;
  mediaHeight: number;
  artSize: number;
  scopeWidth: number;
  scopeHeight: number;
  mediaTopMargin: number;
  mediaBottomGap: number;
  showSecondaryControls: boolean;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function getNowPlayingLayout(windowWidth: number, availableHeight: number): NowPlayingLayout {
  const contentPadding =
    windowWidth < 360 ? NARROW_CONTENT_SIDE_PADDING : CONTENT_SIDE_PADDING;
  const contentWidth = Math.max(0, Math.min(windowWidth - contentPadding * 2, MAX_CONTENT_WIDTH));
  const mediaMax = Math.min(contentWidth, MEDIA_AREA_MAX);
  const mediaMin = Math.min(mediaMax, MEDIA_AREA_MIN);
  const showSecondaryControls = availableHeight >= SECONDARY_CONTROLS_MIN_HEIGHT;
  const mediaTopMargin = availableHeight < 680 ? spacing.md : MEDIA_TOP_MARGIN;
  const mediaBottomGap = availableHeight < 680 ? spacing.lg : MEDIA_BOTTOM_GAP;
  const secondaryHeight = showSecondaryControls ? SUB_TOP_MARGIN + SUB_BUTTON_SIZE : 0;
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
    secondaryHeight +
    MIN_FLOATING_SPACE;
  const heightBoundMedia = availableHeight - fixedHeight;
  const mediaHeight = Math.round(clamp(heightBoundMedia, mediaMin, mediaMax));
  const artSize = Math.min(mediaHeight, ART_SIZE_MAX);
  const scopeWidth = contentWidth;
  const scopeHeight = Math.min(
    mediaHeight,
    Math.round(clamp(scopeWidth * SCOPE_HEIGHT_RATIO, SCOPE_HEIGHT_MIN, SCOPE_HEIGHT_MAX))
  );

  return {
    contentPadding,
    contentWidth,
    mediaHeight,
    artSize,
    scopeWidth,
    scopeHeight,
    mediaTopMargin,
    mediaBottomGap,
    showSecondaryControls,
  };
}

export default function NowPlayingScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const [showScopeStage, setShowScopeStage] = useState(false);
  const track = usePlayerStore((s) => s.currentTrack);
  const playbackState = usePlayerStore((s) => s.playbackState);
  const currentTime = usePlayerStore((s) => s.currentTime);
  const duration = usePlayerStore((s) => s.duration);

  const isPlaying = playbackState === 'playing';
  const isLoading = playbackState === 'loading';
  const availableHeight = windowHeight - insets.top - insets.bottom;
  const layout = getNowPlayingLayout(windowWidth, availableHeight);
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
        translateY.value = withSpring(0, { damping: 20, stiffness: 220 });
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
                <Pressable
                  onPress={() => setShowScopeStage((visible) => !visible)}
                  accessibilityRole="button"
                  accessibilityLabel={showScopeStage ? 'Show artwork' : 'Show visualizer'}
                  style={[
                    styles.mediaArea,
                    {
                      height: layout.mediaHeight,
                      marginTop: layout.mediaTopMargin,
                      marginBottom: layout.mediaBottomGap,
                    },
                  ]}
                >
                  {showScopeStage ? (
                    <View
                      style={[
                        styles.scopeSurface,
                        {
                          width: layout.scopeWidth,
                          height: layout.scopeHeight,
                        },
                      ]}
                    >
                      <Visualizer
                        width={layout.scopeWidth}
                        height={layout.scopeHeight}
                        interactive={false}
                        showChrome={false}
                        mode="spectrum"
                        edgeFade
                      />
                    </View>
                  ) : (
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
                  )}
                </Pressable>

                <View style={styles.trackInfo}>
                  <Text variant="heading" numberOfLines={2} style={styles.centered}>
                    {track.title}
                  </Text>
                  <Text variant="body" numberOfLines={1} style={[styles.centered, styles.artist]}>
                    {track.artist}
                  </Text>
                  <View style={styles.badges}>
                    <FormatBadges track={track} />
                  </View>
                </View>

                <View style={styles.spacer} />

                <View style={styles.playerControls}>
                  <View style={styles.progressBlock}>
                    <WaveformSeekBar
                      currentTime={currentTime}
                      duration={duration}
                      height={WAVEFORM_HEIGHT}
                      touchPadding={WAVEFORM_TOUCH_PADDING}
                      trackKey={track.id}
                      trackPath={track.path}
                      onSeek={(seconds) => void seekTo(seconds)}
                    />
                  </View>

                  <View style={styles.transport}>
                    <Pressable onPress={skipToPrevious} hitSlop={12}>
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
                    <Pressable onPress={skipToNext} hitSlop={12}>
                      <Ionicons
                        name="play-skip-forward"
                        size={SKIP_ICON_SIZE}
                        color={colors.textPrimary}
                      />
                    </Pressable>
                  </View>

                  {layout.showSecondaryControls && (
                    <View style={styles.subRow}>
                      {SUB_CONTROLS.map((c) => (
                        <Pressable
                          key={c.label}
                          hitSlop={10}
                          style={styles.subBtn}
                          accessibilityLabel={c.label}
                        >
                          <Ionicons
                            name={c.icon}
                            size={SUB_ICON_SIZE}
                            color={colors.textTertiary}
                          />
                        </Pressable>
                      ))}
                    </View>
                  )}
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
  mediaArea: {
    width: '100%',
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
  scopeSurface: {
    justifyContent: 'center',
    overflow: 'hidden',
  },
  artImage: {
    width: '100%',
    height: '100%',
  },
  trackInfo: {
    alignItems: 'center',
    alignSelf: 'stretch',
  },
  centered: {
    textAlign: 'center',
  },
  artist: {
    color: colors.accentText,
    marginTop: spacing.xs,
  },
  badges: {
    marginTop: spacing.md,
  },
  progressBlock: {
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
    justifyContent: 'center',
    gap: TRANSPORT_GAP,
    marginTop: TRANSPORT_TOP_MARGIN,
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
    justifyContent: 'space-between',
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

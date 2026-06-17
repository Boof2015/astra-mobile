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

export default function NowPlayingScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const track = usePlayerStore((s) => s.currentTrack);
  const playbackState = usePlayerStore((s) => s.playbackState);
  const currentTime = usePlayerStore((s) => s.currentTime);
  const duration = usePlayerStore((s) => s.duration);

  const isPlaying = playbackState === 'playing';
  const isLoading = playbackState === 'loading';
  const contentWidth = windowWidth - spacing.xl * 2;
  const artSize = Math.min(296, contentWidth);
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
            { paddingTop: insets.top + spacing.sm, paddingBottom: insets.bottom + spacing.lg },
          ]}
        >
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
            <>
              <View style={styles.artWrap}>
                <View style={[styles.art, { width: artSize, height: artSize }]}>
                  {track.artworkData ? (
                    <Image
                      source={{ uri: track.artworkData }}
                      style={styles.artImage}
                      contentFit="cover"
                    />
                  ) : (
                    <AstraLogo size={Math.round(artSize * 0.4)} />
                  )}
                </View>
              </View>

              <Visualizer width={contentWidth} />

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

              <View style={styles.progressBlock}>
                <WaveformSeekBar
                  currentTime={currentTime}
                  duration={duration}
                  trackKey={track.id}
                  trackPath={track.path}
                  onSeek={(seconds) => void seekTo(seconds)}
                />
              </View>

              <View style={styles.spacer} />

              <View style={styles.transport}>
                <Pressable onPress={skipToPrevious} hitSlop={12}>
                  <Ionicons name="play-skip-back" size={32} color={colors.textPrimary} />
                </Pressable>
                <Pressable onPress={togglePlay} hitSlop={12} style={styles.playButton}>
                  <Ionicons
                    name={isLoading ? 'ellipsis-horizontal' : isPlaying ? 'pause' : 'play'}
                    size={34}
                    color={colors.bgPrimary}
                  />
                </Pressable>
                <Pressable onPress={skipToNext} hitSlop={12}>
                  <Ionicons name="play-skip-forward" size={32} color={colors.textPrimary} />
                </Pressable>
              </View>

              <View style={styles.subRow}>
                {SUB_CONTROLS.map((c) => (
                  <Pressable
                    key={c.label}
                    hitSlop={10}
                    style={styles.subBtn}
                    accessibilityLabel={c.label}
                  >
                    <Ionicons name={c.icon} size={20} color={colors.textTertiary} />
                  </Pressable>
                ))}
              </View>
            </>
          ) : (
            <View style={styles.empty}>
              <Text variant="heading">Nothing playing</Text>
              <Text variant="body" color={colors.textSecondary} style={styles.centered}>
                Start a track from Home.
              </Text>
            </View>
          )}
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
    paddingHorizontal: spacing.xl,
  },
  header: {
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
  artWrap: {
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: spacing.lg,
    marginBottom: spacing.lg,
  },
  art: {
    borderRadius: radius.lg,
    backgroundColor: colors.bgTertiary,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  artImage: {
    width: '100%',
    height: '100%',
  },
  trackInfo: {
    marginTop: spacing.md,
    alignItems: 'center',
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
    marginTop: spacing.lg,
  },
  spacer: {
    flex: 1,
    minHeight: spacing.md,
  },
  transport: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xxl,
  },
  playButton: {
    width: 68,
    height: 68,
    borderRadius: radius.pill,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  subRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: spacing.lg,
    paddingHorizontal: spacing.sm,
  },
  subBtn: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  empty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

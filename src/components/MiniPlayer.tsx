import { useState } from 'react';
import {
  View,
  Pressable,
  StyleSheet,
  type LayoutChangeEvent
} from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { usePlayerUiStore } from '@/stores/playerUiStore';
import { Text } from './Text';
import { AstraLogo } from './AstraLogo';
import { SpectrumCurve } from './SpectrumCurve';
import {
  radius,
  spacing,
} from '@/theme';
import { createThemedStyles, useColors } from '@/theme/themed';
import { useRipple } from '@/theme/ripple';
import { usePlayerStore } from '@/stores/playerStore';
import { useDesktopRemoteStore } from '@/stores/desktopRemoteStore';
import { usePlaybackTargetStore } from '@/stores/playbackTargetStore';
import { skipToNext, togglePlay } from '@/audio/playbackController';
import { useScopeActive } from '@/scope/scopeStore';
import { artworkThumbFromSource } from '@/library/artwork';
import { useSmoothPlaybackTime } from '@/audio/useSmoothPlaybackTime';
import { useAppForeground } from '@/lib/useAppForeground';
import { PlaybackTargetPicker } from './PlaybackTargetPicker';
import {
  getDesktopPlaybackPresentation,
  getEffectivePlaybackPresentation,
  getPhonePlaybackPresentation,
} from '@/playback/playbackTargetPresentation';

const PILL_HEIGHT = 56;
const ART = 42;
const CURVE_POINTS = 64;

function MiniProgress({
  currentTime,
  duration,
  isPlaying,
}: {
  currentTime: number;
  duration: number;
  isPlaying: boolean;
}) {
  const styles = useStyles();
  const smoothTime = useSmoothPlaybackTime(currentTime, duration, isPlaying);
  const progress = duration > 0 ? Math.min(1, smoothTime / duration) : 0;
  return (
    <View style={styles.progressTrack}>
      <View style={[styles.progressFill, { width: `${progress * 100}%` }]} />
    </View>
  );
}

/** Phone-target progress: subscribes here so the 2Hz tick skips the whole pill. */
function PhoneMiniProgress({ isPlaying }: { isPlaying: boolean }) {
  const currentTime = usePlayerStore((s) => s.currentTime);
  const duration = usePlayerStore((s) => s.duration);
  return <MiniProgress currentTime={currentTime} duration={duration} isPlaying={isPlaying} />;
}

/**
 * Persistent floating mini-player (M3 redesign): a rounded pill above the tab
 * bar with the live filled-line spectrum drifting behind the metadata. Tapping
 * opens the full now-playing screen.
 */
export function MiniPlayer() {
  const styles = useStyles();
  const colors = useColors();
  const ripple = useRipple();
  const playerOpen = usePlayerUiStore((s) => s.playerOpen);
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
      void sendDesktopControl('next');
      return;
    }
    void skipToNext();
  };

  return (
    <>
      <Pressable
        android_ripple={ripple.bounded}
        style={styles.pill}
        onPress={() => usePlayerUiStore.getState().openPlayer()}
        onLayout={onLayout}
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
          <View style={styles.art}>
            {presentation.artworkUri ? (
              <Image
                source={{ uri: artworkThumbFromSource(presentation.artworkUri) ?? presentation.artworkUri }}
                style={styles.artImage}
                contentFit="cover"
              />
            ) : (
              <AstraLogo size={20} />
            )}
          </View>

          <View style={styles.meta}>
            <Text variant="body" numberOfLines={1} style={styles.title}>
              {presentation.title}
            </Text>
            <Text variant="label" numberOfLines={1}>
              {presentation.subtitle}
            </Text>
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
          <Pressable hitSlop={10} android_ripple={ripple.icon(22)} onPress={onSkipNext} style={styles.control}>
            <Ionicons name="play-skip-forward" size={22} color={colors.textPrimary} />
          </Pressable>
        </View>

        {presentation.hasTrack ? (
          isDesktop ? (
            <MiniProgress
              currentTime={presentation.currentTime}
              duration={presentation.duration}
              isPlaying={isPlaying}
            />
          ) : (
            <PhoneMiniProgress isPlaying={isPlaying} />
          )
        ) : null}
      </Pressable>
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
    marginHorizontal: spacing.md,
    marginTop: spacing.sm,
    marginBottom: spacing.sm,
    borderRadius: radius.lg,
    backgroundColor: colors.bgTertiary,
    borderColor: colors.glassBorder,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
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
    width: 36,
    height: 36,
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
    height: 2,
    backgroundColor: colors.accent,
  },
}));

export default MiniPlayer;

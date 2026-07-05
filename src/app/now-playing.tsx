import { useMemo, useState } from 'react';
import {
  View,
  Pressable,
  StyleSheet,
  useWindowDimensions
} from 'react-native';
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
  withTiming
} from 'react-native-reanimated';
import { Text } from '@/components/Text';
import { AstraLogo } from '@/components/AstraLogo';
import { FormatBadges } from '@/components/FormatBadge';
import { RemoteSourceBadge } from '@/components/RemoteSourceBadge';
import { MarqueeText } from '@/components/MarqueeText';
import { WaveformSeekBar } from '@/components/WaveformSeekBar';
import { Visualizer } from '@/components/Visualizer';
import { TrackActionsSheet } from '@/components/library/TrackActionsSheet';
import { QueueTray } from '@/components/queue/QueueTray';
import {
  colors,
  radius,
  spacing
} from '@/theme';
import { WIDE_MIN_WIDTH, isWideWindow } from '@/theme/adaptive';
import { motion } from '@/theme/motion';
import { resolveNavigationArtist } from '@/library/artistGrouping';
import { useLibraryStore } from '@/stores/libraryStore';
import { usePlayerStore } from '@/stores/playerStore';
import { usePlaylistStore } from '@/stores/playlistStore';
import { useSettingsStore } from '@/stores/settingsStore';
import type { DbTrack } from '@/types/library';
import {
  cycleRepeat,
  seekTo,
  skipToNext,
  skipToPrevious,
  togglePlay,
  toggleShuffle
} from '@/audio/playbackController';

const DISMISS_DISTANCE = 140;
const DISMISS_VELOCITY = 1000;

const MAX_CONTENT_WIDTH = 408;
const CONTENT_SIDE_PADDING = spacing.lg;
const NARROW_CONTENT_SIDE_PADDING = spacing.md;
const MEDIA_AREA_MIN = 220;
// Tablet-portrait tier: tall windows >= WIDE_MIN_WIDTH keep the single column but grow it.
const TABLET_MAX_CONTENT_WIDTH = 520;
const TABLET_ART_SIZE_MAX = 440;
// Wide (landscape/desktop) tier: two panes, art left, controls right.
const WIDE_MAX_CONTENT_WIDTH = 960;
const WIDE_PANE_GAP = spacing.xxl;
const WIDE_RIGHT_PANE_MIN = 300;
const WIDE_RIGHT_PANE_MAX = MAX_CONTENT_WIDTH;
const WIDE_ART_SIZE_MAX = 400;
const WIDE_ART_SIZE_MIN = 160;
const WIDE_COMPACT_HEIGHT = 480;
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
const MENU_ANIMATION_IN_MS = 130;
const MENU_ANIMATION_OUT_MS = 100;
const MENU_ENTER_OFFSET_Y = -8;

interface NowPlayingLayout {
  isWide: boolean;
  contentPadding: number;
  contentWidth: number;
  leftPaneWidth: number;
  rightPaneWidth: number;
  controlsGap: number;
  trackInfoGap: number;
  waveformHeight: number;
  mediaStackHeight: number;
  artSize: number;
  scopeWidth: number;
  scopeHeight: number;
  visualizerTopGap: number;
  visualizerBottomGap: number;
  mediaTopMargin: number;
  mediaBottomGap: number;
}

interface NowPlayingMenuItem {
  key: string;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  onPress: () => void;
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
  availableWidth: number,
  availableHeight: number,
  showVisualizer: boolean
): NowPlayingLayout {
  const isWide = isWideWindow(availableWidth, availableHeight);

  if (isWide) {
    const contentPadding = CONTENT_SIDE_PADDING;
    const contentWidth = Math.max(
      0,
      Math.min(availableWidth - contentPadding * 2, WIDE_MAX_CONTENT_WIDTH)
    );
    const rightPaneWidth = Math.round(
      clamp(contentWidth * 0.46, WIDE_RIGHT_PANE_MIN, WIDE_RIGHT_PANE_MAX)
    );
    const leftPaneWidth = Math.max(0, contentWidth - WIDE_PANE_GAP - rightPaneWidth);
    const scopeWidth = Math.min(leftPaneWidth, VISUALIZER_WIDTH_MAX);
    const scopeHeight = getScopeHeight(scopeWidth);
    const visualizerTopGap = showVisualizer ? VISUALIZER_TOP_GAP : 0;
    const verticalBudget =
      availableHeight - CONTENT_TOP_PADDING - CONTENT_BOTTOM_PADDING - HEADER_HEIGHT - spacing.md;
    const artHeightBudget = verticalBudget - (showVisualizer ? scopeHeight + visualizerTopGap : 0);
    const artSize = Math.round(
      clamp(Math.min(leftPaneWidth, artHeightBudget), WIDE_ART_SIZE_MIN, WIDE_ART_SIZE_MAX)
    );
    const controlsGap = availableHeight < WIDE_COMPACT_HEIGHT ? spacing.sm : spacing.lg;
    return {
      isWide: true,
      contentPadding,
      contentWidth,
      leftPaneWidth,
      rightPaneWidth,
      controlsGap,
      trackInfoGap: spacing.md,
      waveformHeight: WAVEFORM_HEIGHT,
      mediaStackHeight: showVisualizer
        ? artSize + visualizerTopGap + scopeHeight
        : artSize,
      artSize,
      scopeWidth,
      scopeHeight,
      visualizerTopGap,
      visualizerBottomGap: 0,
      mediaTopMargin: 0,
      mediaBottomGap: 0,
    };
  }

  // Tall windows: single column. Tablet-width ones get a larger column and art cap.
  const isTabletColumn = availableWidth >= WIDE_MIN_WIDTH;
  const contentPadding =
    availableWidth < 360 ? NARROW_CONTENT_SIDE_PADDING : CONTENT_SIDE_PADDING;
  const maxContentWidth = isTabletColumn ? TABLET_MAX_CONTENT_WIDTH : MAX_CONTENT_WIDTH;
  const contentWidth = Math.max(0, Math.min(availableWidth - contentPadding * 2, maxContentWidth));
  const scopeWidth = Math.max(
    0,
    Math.min(availableWidth - VISUALIZER_SIDE_PADDING * 2, VISUALIZER_WIDTH_MAX)
  );
  const scopeHeight = getScopeHeight(scopeWidth);
  // Art may grow to the full column width when the height budget allows it.
  const mediaMax = Math.min(contentWidth, isTabletColumn ? TABLET_ART_SIZE_MAX : contentWidth);
  const mediaMin = Math.min(mediaMax, MEDIA_AREA_MIN);
  const mediaTopMargin = availableHeight < 680 ? spacing.md : MEDIA_TOP_MARGIN;
  const defaultMediaBottomGap = availableHeight < 680 ? spacing.lg : MEDIA_BOTTOM_GAP;
  const mediaBottomGap = defaultMediaBottomGap;
  const fixedHeightBase =
    CONTENT_TOP_PADDING +
    CONTENT_BOTTOM_PADDING +
    HEADER_HEIGHT +
    mediaTopMargin +
    TRACK_INFO_ESTIMATE +
    WAVEFORM_BLOCK_ESTIMATE +
    TRANSPORT_TOP_MARGIN +
    PLAY_BUTTON_SIZE +
    SUB_TOP_MARGIN +
    SUB_BUTTON_SIZE +
    MIN_FLOATING_SPACE;
  // The Math.max(96, ...) floor lets art shrink below MEDIA_AREA_MIN in squat
  // windows (split-screen halves) instead of pushing the controls off-screen.
  const bound = availableHeight - fixedHeightBase - mediaBottomGap;
  const scopeOffArt = Math.round(
    clamp(bound, Math.min(mediaMin, Math.max(96, bound)), mediaMax)
  );
  // Roomy screens get a taller waveform; the rest of the spare space is
  // distributed between the control rows by flex (space-between), so no
  // height estimate error can pool as one gap above the controls.
  const offSurplus = Math.max(0, bound - scopeOffArt);
  const stretchUnit = Math.min(Math.floor(offSurplus / 5), spacing.md);
  const waveformHeight = WAVEFORM_HEIGHT + stretchUnit * 2;
  // The media stack keeps one locked height in both scope states — the scope
  // steals its space from the art alone, so toggling it moves nothing else.
  const scopeBlockHeight = VISUALIZER_TOP_GAP + scopeHeight + VISUALIZER_BOTTOM_GAP;
  const mediaStackHeight = Math.max(scopeOffArt, 96 + scopeBlockHeight);
  const scopeOnArt = mediaStackHeight - scopeBlockHeight;
  const artSize = showVisualizer ? scopeOnArt : scopeOffArt;

  const visualizerTopGap = showVisualizer ? VISUALIZER_TOP_GAP : 0;
  const visualizerBottomGap = showVisualizer ? VISUALIZER_BOTTOM_GAP : 0;

  return {
    isWide: false,
    contentPadding,
    contentWidth,
    leftPaneWidth: contentWidth,
    rightPaneWidth: contentWidth,
    controlsGap: TRANSPORT_TOP_MARGIN,
    trackInfoGap: spacing.md,
    waveformHeight,
    mediaStackHeight,
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
  const [menuOpen, setMenuOpen] = useState(false);
  const [playlistActionTrack, setPlaylistActionTrack] = useState<DbTrack | null>(null);
  const scopeMode = useSettingsStore((s) => s.scopeMode);
  const scopeStageVisible = useSettingsStore((s) => s.scopeStageVisible);
  const setScopeStageVisible = useSettingsStore((s) => s.setScopeStageVisible);
  const artistGroupingMode = useSettingsStore((s) => s.artistGroupingMode);
  const libraryTracks = useLibraryStore((s) => s.tracks);
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
  const effectiveWidth = windowWidth - insets.left - insets.right;
  const layout = getNowPlayingLayout(effectiveWidth, availableHeight, scopeStageVisible);
  const source = track?.album?.trim() ? track.album : 'Library';
  const shellRight =
    insets.right +
    layout.contentPadding +
    Math.max(0, (effectiveWidth - layout.contentPadding * 2 - layout.contentWidth) / 2);
  const menuTop = insets.top + CONTENT_TOP_PADDING + HEADER_HEIGHT + spacing.xs;
  const libraryTrack = useMemo(
    () => (track ? libraryTracks.find((entry) => entry.path === track.path) ?? null : null),
    [libraryTracks, track]
  );
  const artistName = track
    ? resolveNavigationArtist(
        libraryTrack ?? { artist: track.artist, album_artist: track.albumArtist ?? null },
        artistGroupingMode
      )
    : '';
  const albumKey = track?.albumIdentityKey ?? libraryTrack?.album_identity_key;

  const navigateToArtist = () => {
    if (!artistName) return;
    router.dismissTo({
      pathname: '/library/artist/[name]',
      params: { name: artistName },
    });
  };

  const navigateToAlbum = () => {
    if (!albumKey) return;
    router.dismissTo({
      pathname: '/library/album/[key]',
      params: { key: albumKey },
    });
  };

  const menuItems: NowPlayingMenuItem[] = [];
  if (artistName) {
    menuItems.push({
      key: 'artist',
      label: 'View artist',
      icon: 'person-outline',
      onPress: () => {
        closeMenu();
        navigateToArtist();
      },
    });
  }
  if (albumKey) {
    menuItems.push({
      key: 'album',
      label: 'View album',
      icon: 'albums-outline',
      onPress: () => {
        closeMenu();
        navigateToAlbum();
      },
    });
  }
  if (libraryTrack) {
    menuItems.push({
      key: 'add-to-playlist',
      label: 'Add to playlist...',
      icon: 'add-circle-outline',
      onPress: () => {
        closeMenu();
        setPlaylistActionTrack(libraryTrack);
      },
    });
  }

  // Swipe down to minimize. The stack transition is disabled for this route, so
  // the sheet owns one continuous enter/exit animation instead of handing off to
  // a second native modal animation after release.
  const translateY = useSharedValue(0);
  const menuProgress = useSharedValue(0);
  // Belt-and-suspenders for deep-link entry (widget/notification → now-playing with no
  // history): `(tabs)` is the stack anchor (see root _layout unstable_settings), so back()
  // returns there; if somehow there's nothing to go back to, replace to the tabs home so
  // dismissing can never land on a blank screen.
  const dismiss = () => {
    if (router.canGoBack()) router.back();
    else router.replace('/');
  };
  const finishCloseMenu = () => setMenuOpen(false);

  function openMenu() {
    if (menuItems.length === 0) return;
    menuProgress.value = 0;
    setMenuOpen(true);
    menuProgress.value = withTiming(1, { duration: MENU_ANIMATION_IN_MS });
  }

  function closeMenu() {
    menuProgress.value = withTiming(0, { duration: MENU_ANIMATION_OUT_MS }, (finished) => {
      if (finished) runOnJS(finishCloseMenu)();
    });
  }

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

  const menuLayerStyle = useAnimatedStyle(() => ({
    opacity: menuProgress.value,
  }));

  const menuCardStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: MENU_ENTER_OFFSET_Y * (1 - menuProgress.value) }],
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
              paddingLeft: insets.left + layout.contentPadding,
              paddingRight: insets.right + layout.contentPadding,
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
              <Pressable
                style={styles.headerBtn}
                onPress={openMenu}
                disabled={menuItems.length === 0}
                hitSlop={12}
                accessibilityLabel="More options"
              >
                <Ionicons name="ellipsis-vertical" size={20} color={colors.textSecondary} />
              </Pressable>
            </View>

            {track ? (
              <View style={[styles.player, layout.isWide && styles.playerWide]}>
                <View
                  style={[
                    styles.middleStack,
                    layout.isWide
                      ? { width: layout.leftPaneWidth, justifyContent: 'center' }
                      : {
                          height: layout.mediaStackHeight,
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

                <View
                  style={[
                    styles.playerControls,
                    layout.isWide
                      ? { width: layout.rightPaneWidth }
                      : styles.playerControlsFill,
                  ]}
                >
                  <View style={[styles.trackInfo, { marginBottom: layout.trackInfoGap }]}>
                    <View style={styles.trackTextStack}>
                      <MarqueeText
                        variant="heading"
                        containerStyle={styles.trackTitle}
                        style={styles.trackTitleText}
                      >
                        {track.title}
                      </MarqueeText>
                      <View style={styles.trackMetaRow}>
                        <Pressable
                          onPress={navigateToArtist}
                          hitSlop={6}
                          style={styles.artistButton}
                          accessibilityRole="link"
                          accessibilityLabel={`View artist ${track.artist}`}
                        >
                          <MarqueeText variant="body" style={styles.artist}>
                            {track.artist}
                          </MarqueeText>
                        </Pressable>
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
                    isPlaying={isPlaying}
                    height={layout.waveformHeight}
                    touchPadding={WAVEFORM_TOUCH_PADDING}
                    trackPath={track.path}
                    onSeek={(seconds) => void seekTo(seconds)}
                  />

                  <View style={[styles.transport, { marginTop: layout.controlsGap }]}>
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

                  <View style={[styles.subRow, { marginTop: layout.controlsGap }]}>
                    <View style={styles.subBadges}>
                      <RemoteSourceBadge sourceType={track.sourceType} />
                      <FormatBadges track={track} wrap={false} />
                    </View>
                    <View style={styles.subActions}>
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
      {menuOpen && menuItems.length > 0 && (
        <Animated.View
          pointerEvents="box-none"
          style={[styles.menuLayer, menuLayerStyle]}
        >
          <Pressable
            style={styles.menuDismiss}
            onPress={closeMenu}
            accessibilityRole="button"
            accessibilityLabel="Close menu"
          />
          <Animated.View
            style={[styles.menuCard, { top: menuTop, right: shellRight }, menuCardStyle]}
          >
            {menuItems.map((item) => (
              <Pressable
                key={item.key}
                style={({ pressed }) => [styles.menuItem, pressed && styles.menuItemPressed]}
                onPress={item.onPress}
                accessibilityRole="button"
              >
                <Ionicons name={item.icon} size={19} color={colors.textSecondary} />
                <Text variant="body" numberOfLines={1} style={styles.menuItemLabel}>
                  {item.label}
                </Text>
              </Pressable>
            ))}
          </Animated.View>
        </Animated.View>
      )}
      <TrackActionsSheet
        track={playlistActionTrack}
        initialStep="pickPlaylist"
        onClose={() => setPlaylistActionTrack(null)}
      />
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
  menuLayer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  menuDismiss: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  menuCard: {
    position: 'absolute',
    width: 212,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glassBorder,
    backgroundColor: colors.bgSecondary,
    paddingVertical: spacing.xs,
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 12,
  },
  menuItem: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.md,
  },
  menuItemPressed: {
    opacity: 0.6,
  },
  menuItemLabel: {
    flex: 1,
  },
  player: {
    flex: 1,
  },
  playerWide: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    columnGap: WIDE_PANE_GAP,
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
  },
  trackTextStack: {
    flex: 1,
    minWidth: 0,
    alignItems: 'flex-start',
  },
  trackTitle: {
    alignSelf: 'stretch',
  },
  trackTitleText: {
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
    flexWrap: 'nowrap',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
  artistButton: {
    flex: 1,
    minWidth: 0,
  },
  centered: {
    textAlign: 'center',
  },
  artist: {
    color: colors.accentText,
  },
  playerControls: {
    width: '100%',
  },
  playerControlsFill: {
    flex: 1,
    justifyContent: 'space-between',
  },
  transport: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
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
    justifyContent: 'space-between',
    gap: spacing.md,
    paddingHorizontal: spacing.sm,
  },
  subBadges: {
    flex: 1,
    minWidth: 0,
    overflow: 'hidden',
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  subActions: {
    flexDirection: 'row',
    alignItems: 'center',
    flexShrink: 0,
    gap: spacing.lg,
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

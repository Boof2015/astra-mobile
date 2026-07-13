import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import {
  BackHandler,
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
  runOnJS,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSpring,
  withTiming
} from 'react-native-reanimated';
import { Text } from '@/components/Text';
import { AstraLogo } from '@/components/AstraLogo';
import { FormatBadges } from '@/components/FormatBadge';
import { RemoteSourceBadge } from '@/components/RemoteSourceBadge';
import { MarqueeText } from '@/components/MarqueeText';
import { NowPlayingWash } from '@/components/NowPlayingWash';
import { SeekBar } from '@/components/SeekBar';
import { WaveformSeekBar } from '@/components/WaveformSeekBar';
import { Visualizer } from '@/components/Visualizer';
import { LyricsView } from '@/components/lyrics/LyricsView';
import { TrackActionsSheet } from '@/components/library/TrackActionsSheet';
import { PlaybackTargetPicker } from '@/components/PlaybackTargetPicker';
import { QueueTray } from '@/components/queue/QueueTray';
import { RemoteQueueSheet } from '@/components/queue/RemoteQueueSheet';
import { TactilePressable } from '@/components/player/TactilePressable';
import { NowPlayingCompanionPane } from '@/components/player/NowPlayingCompanionPane';
import { PlayerStateIcon } from '@/components/player/PlayerStateIcon';
import { CachedLyricPeek } from '@/components/player/CachedLyricPeek';
import {
  radius,
  spacing,
} from '@/theme';
import { createThemedStyles, useColors } from '@/theme/themed';
import { useRipple } from '@/theme/ripple';
import { motion } from '@/theme/motion';
import {
  getNowPlayingLayout,
  getTabletCompanionLayout,
  NOW_PLAYING_CONTENT_BOTTOM_PADDING,
  NOW_PLAYING_CONTENT_TOP_PADDING,
  NOW_PLAYING_HEADER_HEIGHT,
  NOW_PLAYING_PLAY_BUTTON_SIZE,
  NOW_PLAYING_SUB_BUTTON_SIZE,
  NOW_PLAYING_WAVEFORM_TOUCH_PADDING,
  NOW_PLAYING_WIDE_PANE_GAP,
} from '@/components/player/nowPlayingLayout';
import { resolveNavigationArtist, splitCollaborators } from '@/library/artistGrouping';
import { buildArtistNameTokens } from '@/shared/library/artistCredits';
import { artworkThumbFromSource } from '@/library/artwork';
import { useLibraryStore } from '@/stores/libraryStore';
import { useDesktopRemoteStore } from '@/stores/desktopRemoteStore';
import { usePlayerStore } from '@/stores/playerStore';
import { usePlaylistStore } from '@/stores/playlistStore';
import { usePlaybackTargetStore } from '@/stores/playbackTargetStore';
import { usePlayerUiStore } from '@/stores/playerUiStore';
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
import {
  desktopConnectionLabel,
  getDesktopPlaybackPresentation,
  getEffectivePlaybackPresentation,
  getPhonePlaybackPresentation,
  hostFromBaseUrl,
} from '@/playback/playbackTargetPresentation';

const DISMISS_DISTANCE = 140;
const DISMISS_VELOCITY = 1000;

const HEADER_HEIGHT = NOW_PLAYING_HEADER_HEIGHT;
const CONTENT_TOP_PADDING = NOW_PLAYING_CONTENT_TOP_PADDING;
const CONTENT_BOTTOM_PADDING = NOW_PLAYING_CONTENT_BOTTOM_PADDING;
const WAVEFORM_TOUCH_PADDING = NOW_PLAYING_WAVEFORM_TOUCH_PADDING;
const PLAY_BUTTON_SIZE = NOW_PLAYING_PLAY_BUTTON_SIZE;
const SKIP_ICON_SIZE = 32;
const PLAY_ICON_SIZE = 34;
const SUB_BUTTON_SIZE = NOW_PLAYING_SUB_BUTTON_SIZE;
const SUB_ICON_SIZE = 20;
const MENU_ANIMATION_IN_MS = 130;
const MENU_ANIMATION_OUT_MS = 100;
const MENU_ENTER_OFFSET_Y = -8;

interface NowPlayingMenuItem {
  key: string;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  onPress: () => void;
}

export function NowPlayingOverlay() {
  const styles = useStyles();
  const colors = useColors();
  const ripple = useRipple();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const reduceMotion = useReducedMotion();
  const playerOpen = usePlayerUiStore((s) => s.playerOpen);
  const [queueOpen, setQueueOpen] = useState(false);
  // Stable identity: QueueTray is memo'd, so a fresh arrow here would defeat it.
  const closeQueue = useCallback(() => setQueueOpen(false), []);
  const [menuOpen, setMenuOpen] = useState(false);
  const [targetPickerOpen, setTargetPickerOpen] = useState(false);
  const [playlistActionTrack, setPlaylistActionTrack] = useState<DbTrack | null>(null);
  const selectedTarget = usePlaybackTargetStore((s) => s.target);
  const scopeMode = useSettingsStore((s) => s.scopeMode);
  const scopeStageVisible = useSettingsStore((s) => s.scopeStageVisible);
  const setScopeStageVisible = useSettingsStore((s) => s.setScopeStageVisible);
  const lyricsVisible = useSettingsStore((s) => s.lyricsVisible);
  const setLyricsVisible = useSettingsStore((s) => s.setLyricsVisible);
  const nowPlayingCompanion = useSettingsStore((s) => s.nowPlayingCompanion);
  const setNowPlayingCompanion = useSettingsStore((s) => s.setNowPlayingCompanion);
  const artistGroupingMode = useSettingsStore((s) => s.artistGroupingMode);
  const libraryTracks = useLibraryStore((s) => s.tracks);
  const track = usePlayerStore((s) => s.currentTrack);
  const playbackState = usePlayerStore((s) => s.playbackState);
  const shuffle = usePlayerStore((s) => s.shuffle);
  const repeat = usePlayerStore((s) => s.repeat);
  const isFavorite = usePlaylistStore((s) => (track ? s.favoritePaths.has(track.path) : false));
  const toggleFavorite = usePlaylistStore((s) => s.toggleFavorite);
  const desktopConnection = useDesktopRemoteStore((s) => s.connection);
  const desktopConnectionState = useDesktopRemoteStore((s) => s.connectionState);
  const desktopSnapshot = useDesktopRemoteStore((s) => s.snapshot);
  const desktopQueue = useDesktopRemoteStore((s) => s.queue);
  const sendDesktopControl = useDesktopRemoteStore((s) => s.sendControl);
  const reconnectDesktop = useDesktopRemoteStore((s) => s.reconnect);

  const phonePresentation = getPhonePlaybackPresentation({
    track,
    playbackState,
  });
  const desktopPresentation = getDesktopPlaybackPresentation({
    connection: desktopConnection,
    connectionState: desktopConnectionState,
    snapshot: desktopSnapshot,
  });
  const activePresentation = getEffectivePlaybackPresentation({
    selectedTarget,
    phone: phonePresentation,
    desktop: desktopPresentation,
  });
  const isDesktopTarget = activePresentation.target === 'desktop';
  const activeTrack = desktopSnapshot?.currentTrack ?? null;
  const transitionTrackKey = isDesktopTarget ? activeTrack?.id ?? '' : track?.id ?? '';
  const isPlaying = activePresentation.playbackState === 'playing';
  const isLoading = activePresentation.playbackState === 'loading';
  // Wash off a low-res thumbnail (like the album/artist detail headers do) so the
  // blur reads as pure colors — full-res art keeps its detail at any blur radius.
  // currentTrack only carries the full-size artworkData, so derive the thumb from it.
  const washArtworkUri = artworkThumbFromSource(
    isDesktopTarget ? activePresentation.artworkUri : track?.artworkData ?? null
  );
  const availableHeight = windowHeight - insets.top - insets.bottom;
  const effectiveWidth = windowWidth - insets.left - insets.right;
  const standardLayout = getNowPlayingLayout(
    effectiveWidth,
    availableHeight,
    isDesktopTarget ? false : scopeStageVisible
  );
  const tabletCompanionLayout = getTabletCompanionLayout(
    effectiveWidth,
    availableHeight,
    isDesktopTarget ? false : scopeStageVisible
  );
  const hasTabletCompanion = tabletCompanionLayout !== null;
  const lyricPeekEnabled = !isDesktopTarget && availableHeight >= 720;
  const layout = tabletCompanionLayout?.playerLayout ?? standardLayout;
  const contentPadding = tabletCompanionLayout ? spacing.lg : layout.contentPadding;
  const shellWidth = tabletCompanionLayout?.shellWidth ?? layout.contentWidth;
  // Lyrics takes over only on the phone. Roomy tablets keep the player visible
  // and render lyrics in the companion rail.
  const lyricsMode =
    !hasTabletCompanion && !isDesktopTarget && !!track && lyricsVisible;
  const source = activePresentation.sourceLabel;
  const shellRight =
    insets.right +
    contentPadding +
    Math.max(0, (effectiveWidth - contentPadding * 2 - shellWidth) / 2);
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
  const artistCreditTokens = useMemo(() => {
    if (!track) return [];
    const collaborators = splitCollaborators(track.artist);
    return buildArtistNameTokens(
      collaborators.length > 0 ? collaborators : [track.artist]
    ).map((token) => ({
      ...token,
      separator: token.separator ? ', ' : null,
    }));
  }, [track]);
  const albumKey = track?.albumIdentityKey ?? libraryTrack?.album_identity_key;

  useEffect(() => {
    if (!hasTabletCompanion || isDesktopTarget) return;
    if (queueOpen) {
      const frame = requestAnimationFrame(() => {
        setQueueOpen(false);
        void setNowPlayingCompanion('queue');
      });
      return () => cancelAnimationFrame(frame);
    }
    if (lyricsVisible) void setNowPlayingCompanion('lyrics');
    return undefined;
  }, [
    isDesktopTarget,
    lyricsVisible,
    queueOpen,
    setNowPlayingCompanion,
    hasTabletCompanion,
  ]);

  const showLyrics = () => {
    if (hasTabletCompanion) {
      void setNowPlayingCompanion('lyrics');
      return;
    }
    void setLyricsVisible(!lyricsVisible);
  };

  const showQueue = () => {
    if (hasTabletCompanion) {
      if (!isDesktopTarget) {
        void setLyricsVisible(false);
        void setNowPlayingCompanion('queue');
      }
      return;
    }
    setQueueOpen(true);
  };

  const navigateToArtist = (targetArtist = artistName, credit = false) => {
    if (!targetArtist) return;
    // Slide the overlay away while the library detail loads underneath.
    dismissSheet();
    router.navigate({
      pathname: '/library/artist/[name]',
      params: { name: targetArtist, ...(credit ? { credit: '1' } : {}) },
    });
  };

  const navigateToAlbum = () => {
    if (!albumKey) return;
    dismissSheet();
    router.navigate({
      pathname: '/library/album/[key]',
      params: { key: albumKey },
    });
  };

  const menuItems: NowPlayingMenuItem[] = [];
  menuItems.push({
    key: 'output',
    label: 'Choose output device',
    icon: isDesktopTarget ? 'desktop-outline' : 'phone-portrait-outline',
    onPress: () => {
      closeMenu();
      setTargetPickerOpen(true);
    },
  });
  if (!isDesktopTarget && artistName) {
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
  if (!isDesktopTarget && albumKey) {
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
  if (!isDesktopTarget && libraryTrack) {
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

  // The overlay stays mounted; open/close is this one shared value sliding the
  // sheet on the UI thread. Starts off-screen so a pre-warmed mount never flashes.
  const translateY = useSharedValue(windowHeight);
  const menuProgress = useSharedValue(0);
  const trackProgress = useSharedValue(1);

  useEffect(() => {
    if (!transitionTrackKey) return;
    trackProgress.value = 0;
    trackProgress.value = withTiming(1, { ...motion.snap, duration: 200 });
  }, [trackProgress, transitionTrackKey]);
  // Closing is a store toggle, not navigation. Reset the inner layers so a
  // reopen starts from the plain player (parity with the old per-open mount).
  const dismiss = () => {
    setMenuOpen(false);
    setQueueOpen(false);
    usePlayerUiStore.getState().closePlayer();
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

  // Open animation (close normally animates via dismissSheet's spring first;
  // the else branch covers direct closePlayer calls and keeps the resting
  // offset pinned to the current window height across rotation). NOTE: this
  // effect must stay BELOW every direct `translateY.value` write — the react
  // compiler forbids mutations after an effect that depends on the value.
  useEffect(() => {
    if (playerOpen) {
      translateY.value = withTiming(0, { duration: 240 });
    } else {
      translateY.value = withTiming(windowHeight, { duration: 200 });
    }
  }, [playerOpen, windowHeight, translateY]);

  // Hardware back, innermost layer first: menu → queue tray → player. Registered
  // only while open, so it sits above the focused screen's own handlers (LIFO)
  // — e.g. the library-detail back interceptor underneath.
  useEffect(() => {
    if (!playerOpen) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (menuOpen) {
        closeMenu();
        return true;
      }
      if (queueOpen) {
        setQueueOpen(false);
        return true;
      }
      dismissSheet();
      return true;
    });
    return () => sub.remove();
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

  const artworkTransitionStyle = useAnimatedStyle(() => ({
    opacity: 0.75 + trackProgress.value * 0.25,
    transform: [{ scale: 0.985 + trackProgress.value * 0.015 }],
  }));

  const metadataTransitionStyle = useAnimatedStyle(() => ({
    opacity: trackProgress.value,
    transform: [{ translateY: 4 * (1 - trackProgress.value) }],
  }));

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents={playerOpen ? 'auto' : 'none'}>
      <GestureDetector gesture={pan}>
        <Animated.View
          style={[
            styles.content,
            contentStyle,
            {
              paddingLeft: insets.left + contentPadding,
              paddingRight: insets.right + contentPadding,
              paddingTop: insets.top + CONTENT_TOP_PADDING,
              paddingBottom: insets.bottom + CONTENT_BOTTOM_PADDING,
            },
          ]}
        >
          <NowPlayingWash
            artworkUri={washArtworkUri}
            offset={{
              top: -(insets.top + CONTENT_TOP_PADDING),
              left: -(insets.left + contentPadding),
              right: -(insets.right + contentPadding),
            }}
          />
          <View style={[styles.shell, { width: shellWidth }]}>
            {!lyricsMode && (
              <View style={styles.header}>
                <View style={styles.headerSide}>
                  <Pressable style={styles.headerBtn} android_ripple={ripple.icon(22)} onPress={() => dismissSheet()} hitSlop={12}>
                    <Ionicons name="chevron-down" size={26} color={colors.textSecondary} />
                  </Pressable>
                </View>
                <View style={styles.headerMid}>
                  <Text variant="caption" style={styles.eyebrow}>
                    PLAYING FROM
                  </Text>
                  <Text variant="label" numberOfLines={1} style={styles.source}>
                    {source}
                  </Text>
                </View>
                <View style={[styles.headerSide, styles.headerActions]}>
                  {!isDesktopTarget && track ? (
                    <TactilePressable
                      style={styles.headerBtn} android_ripple={ripple.icon(22)}
                      haptic="selection"
                      onPress={showLyrics}
                      hitSlop={12}
                      accessibilityLabel={
                        hasTabletCompanion
                          ? 'Show lyrics in companion'
                          : lyricsVisible
                            ? 'Hide lyrics'
                            : 'Show lyrics'
                      }
                      accessibilityState={{
                        selected: hasTabletCompanion
                          ? nowPlayingCompanion === 'lyrics'
                          : lyricsVisible,
                      }}
                    >
                      <PlayerStateIcon
                        selected={
                          (hasTabletCompanion && nowPlayingCompanion === 'lyrics') ||
                          (!hasTabletCompanion && lyricsVisible)
                        }
                        size={20}
                        inactive={
                          <MaterialCommunityIcons
                            name="script-text-outline"
                            size={20}
                            color={colors.textSecondary}
                          />
                        }
                        active={
                          <MaterialCommunityIcons
                            name="script-text-outline"
                            size={20}
                            color={colors.accent}
                          />
                        }
                      />
                    </TactilePressable>
                  ) : null}
                  <Pressable
                    style={styles.headerBtn} android_ripple={ripple.icon(22)}
                    onPress={openMenu}
                    hitSlop={12}
                    accessibilityLabel="More options"
                  >
                    <Ionicons name="ellipsis-vertical" size={20} color={colors.textSecondary} />
                  </Pressable>
                </View>
              </View>
            )}

            <View style={[styles.playerBody, hasTabletCompanion && styles.playerBodyTablet]}>
              <View
                style={[
                  styles.playerRegion,
                  hasTabletCompanion && styles.playerRegionTablet,
                  tabletCompanionLayout
                    ? {
                        width: tabletCompanionLayout.playerRegionWidth,
                      }
                    : null,
                ]}
              >
                <View style={[styles.playerCanvas, { width: layout.contentWidth }]}>
            {lyricsMode && track ? (
              <LyricsView
                track={track}
                active={playerOpen}
                isPlaying={isPlaying}
                isLoading={isLoading}
                isFavorite={isFavorite}
                onSeek={(seconds) => void seekTo(seconds)}
                onPlayPause={togglePlay}
                onNext={skipToNext}
                onPrev={skipToPrevious}
                onToggleFavorite={() => void toggleFavorite(track)}
                onExitLyrics={() => void setLyricsVisible(false)}
                onDismiss={() => dismissSheet()}
              />
            ) : isDesktopTarget ? (
              activeTrack ? (
                <View style={[styles.player, layout.isWide && styles.playerWide]}>
                  <View
                    style={[
                      styles.middleStack,
                      !layout.isWide && styles.middleStackCentered,
                      layout.isWide
                        ? { width: layout.leftPaneWidth, justifyContent: 'center' }
                        : {
                            height: layout.mediaStackHeight,
                            marginTop: layout.mediaTopMargin,
                            marginBottom: layout.mediaBottomGap,
                          },
                    ]}
                  >
                    <Animated.View
                      style={[
                        styles.artCard,
                        artworkTransitionStyle,
                        {
                          width: layout.artSize,
                          height: layout.artSize,
                        },
                      ]}
                    >
                      {activePresentation.artworkUri ? (
                        <Image
                          source={{ uri: activePresentation.artworkUri }}
                          style={styles.artImage}
                          contentFit="cover"
                          transition={reduceMotion ? null : 200}
                        />
                      ) : (
                        <AstraLogo size={Math.round(layout.artSize * 0.4)} />
                      )}
                    </Animated.View>
                  </View>

                  <View
                    style={[
                      styles.playerControls,
                      layout.isWide
                        ? { width: layout.rightPaneWidth }
                        : styles.playerControlsFill,
                  ]}
                >
                    <View style={styles.primaryControls}>
                    <Animated.View
                      style={[
                        styles.trackInfo,
                        { marginBottom: layout.trackInfoGap },
                        metadataTransitionStyle,
                      ]}
                    >
                      <View style={styles.trackTextStack}>
                        <MarqueeText
                          variant="heading"
                          containerStyle={styles.trackTitle}
                          style={styles.trackTitleText}
                        >
                          {activeTrack.title}
                        </MarqueeText>
                        <MarqueeText variant="body" style={styles.artist}>
                          {activeTrack.artist || activeTrack.album || activePresentation.deviceLabel}
                        </MarqueeText>
                      </View>
                      <TactilePressable
                        hitSlop={10}
                        style={styles.inlineActionBtn} android_ripple={ripple.icon(22)}
                        haptic="light"
                        confirmationScale={1.08}
                        onPress={() => void sendDesktopControl('toggle-favorite')}
                        accessibilityLabel={activeTrack.isFavorite ? 'Remove from favorites' : 'Add to favorites'}
                        accessibilityState={{ selected: activeTrack.isFavorite }}
                      >
                        <PlayerStateIcon
                          selected={activeTrack.isFavorite}
                          size={SUB_ICON_SIZE + 4}
                          inactive={
                            <Ionicons
                              name="heart-outline"
                              size={SUB_ICON_SIZE + 4}
                              color={colors.textTertiary}
                            />
                          }
                          active={
                            <Ionicons
                              name="heart"
                              size={SUB_ICON_SIZE + 4}
                              color={colors.accent}
                            />
                          }
                        />
                      </TactilePressable>
                    </Animated.View>

                    <SeekBar
                      currentTime={activePresentation.currentTime}
                      duration={activePresentation.duration}
                      trackKey={activeTrack.id}
                      onSeek={(seconds) => void sendDesktopControl('seek', seconds)}
                    />

                    <View style={[styles.transport, { marginTop: layout.controlsGap }]}>
                      <TactilePressable
                        hitSlop={10}
                        android_ripple={ripple.icon(24)}
                        style={[
                          styles.transportSideBtn,
                          desktopSnapshot?.shuffle === undefined && styles.controlDisabled,
                        ]}
                        disabled={desktopSnapshot?.shuffle === undefined}
                        haptic="selection"
                        onPress={() => void sendDesktopControl('toggle-shuffle')}
                        accessibilityLabel="Shuffle"
                        accessibilityState={{ selected: Boolean(desktopSnapshot?.shuffle) }}
                      >
                        <PlayerStateIcon
                          selected={Boolean(desktopSnapshot?.shuffle)}
                          size={SUB_ICON_SIZE + 2}
                          inactive={
                            <Ionicons name="shuffle" size={SUB_ICON_SIZE + 2} color={colors.textTertiary} />
                          }
                          active={
                            <Ionicons name="shuffle" size={SUB_ICON_SIZE + 2} color={colors.accent} />
                          }
                        />
                      </TactilePressable>
                      <TactilePressable
                        onPress={() => void sendDesktopControl('previous')}
                        haptic="light"
                        hitSlop={12}
                        style={styles.transportMainBtn} android_ripple={ripple.icon(26)}
                        accessibilityLabel="Previous"
                      >
                        <Ionicons
                          name="play-skip-back"
                          size={SKIP_ICON_SIZE}
                          color={colors.textPrimary}
                        />
                      </TactilePressable>
                      <TactilePressable
                        onPress={() => void sendDesktopControl(isPlaying ? 'pause' : 'play')}
                        haptic="light"
                        pressedScale={0.97}
                        hitSlop={12}
                        style={styles.playButton} android_ripple={ripple.onAccent()}
                        accessibilityLabel={isPlaying ? 'Pause desktop' : 'Play desktop'}
                      >
                        <Ionicons
                          name={isLoading ? 'ellipsis-horizontal' : isPlaying ? 'pause' : 'play'}
                          size={PLAY_ICON_SIZE}
                          color={colors.bgPrimary}
                        />
                      </TactilePressable>
                      <TactilePressable
                        onPress={() => void sendDesktopControl('next')}
                        haptic="light"
                        hitSlop={12}
                        style={styles.transportMainBtn} android_ripple={ripple.icon(26)}
                        accessibilityLabel="Next"
                      >
                        <Ionicons
                          name="play-skip-forward"
                          size={SKIP_ICON_SIZE}
                          color={colors.textPrimary}
                        />
                      </TactilePressable>
                      <TactilePressable
                        hitSlop={10}
                        android_ripple={ripple.icon(24)}
                        style={[
                          styles.transportSideBtn,
                          desktopSnapshot?.repeat === undefined && styles.controlDisabled,
                        ]}
                        disabled={desktopSnapshot?.repeat === undefined}
                        haptic="selection"
                        onPress={() => void sendDesktopControl('toggle-repeat')}
                        accessibilityLabel="Repeat"
                        accessibilityState={{ selected: desktopSnapshot?.repeat !== 'none' }}
                      >
                        <PlayerStateIcon
                          selected={desktopSnapshot?.repeat !== 'none'}
                          size={SUB_ICON_SIZE + 2}
                          inactive={
                            <Ionicons name="repeat" size={SUB_ICON_SIZE + 2} color={colors.textTertiary} />
                          }
                          active={desktopSnapshot?.repeat === 'one' ? (
                            <MaterialCommunityIcons
                              name="repeat-once"
                              size={SUB_ICON_SIZE + 2}
                              color={colors.accent}
                            />
                          ) : (
                            <Ionicons name="repeat" size={SUB_ICON_SIZE + 2} color={colors.accent} />
                          )}
                        />
                      </TactilePressable>
                    </View>
                    </View>

                    <View
                      style={[
                        styles.subRow,
                        layout.isWide
                          ? { marginTop: layout.controlsGap }
                          : styles.utilityFooter,
                      ]}
                    >
                      <View style={styles.statusPill}>
                        <View
                          style={[
                            styles.statusDot,
                            {
                              backgroundColor:
                                desktopConnectionState === 'connected' ? colors.accent : colors.warning,
                            },
                          ]}
                        />
                        <Text variant="label" color={colors.textSecondary}>
                          {desktopConnectionLabel(desktopConnectionState)}
                        </Text>
                      </View>
                      <Text
                        variant="caption"
                        color={colors.textTertiary}
                        numberOfLines={1}
                        style={styles.remoteDetail}
                      >
                        {desktopSnapshot?.outputDeviceLabel?.trim() ||
                          (desktopConnection ? hostFromBaseUrl(desktopConnection.baseUrl) : '')}
                      </Text>
                      <View style={styles.subActions}>
                        <TactilePressable
                          hitSlop={10}
                          style={styles.subBtn} android_ripple={ripple.icon(20)}
                          onPress={() => void reconnectDesktop()}
                          accessibilityLabel="Reconnect to desktop"
                        >
                          <Ionicons name="refresh" size={SUB_ICON_SIZE + 2} color={colors.textTertiary} />
                        </TactilePressable>
                        {desktopQueue ? (
                          <TactilePressable
                            hitSlop={10}
                            style={styles.subBtn} android_ripple={ripple.icon(20)}
                            haptic="selection"
                            onPress={showQueue}
                            accessibilityLabel="Desktop queue"
                          >
                            <Ionicons name="list-outline" size={SUB_ICON_SIZE + 2} color={colors.textTertiary} />
                          </TactilePressable>
                        ) : null}
                      </View>
                    </View>
                  </View>
                </View>
              ) : (
                <View style={styles.empty}>
                  <AstraLogo size={72} />
                  <Text variant="heading" style={styles.emptyTitle}>
                    {desktopConnection ? 'Nothing playing on desktop' : 'No desktop paired'}
                  </Text>
                  <Text variant="body" color={colors.textSecondary} style={styles.centered}>
                    {desktopConnection
                      ? desktopConnectionLabel(desktopConnectionState)
                      : 'Pair with Astra Desktop to control it here.'}
                  </Text>
                  <Pressable
                    style={styles.emptyAction} android_ripple={ripple.bounded}
                    onPress={() => {
                      if (desktopConnection) {
                        void reconnectDesktop();
                        return;
                      }
                      // Route change happens under the overlay; slide it away.
                      dismissSheet();
                      router.push('/desktop-remote' as never);
                    }}
                  >
                    <Text variant="label" color={colors.accentTextStrong}>
                      {desktopConnection ? 'Reconnect' : 'Pair desktop'}
                    </Text>
                  </Pressable>
                </View>
              )
            ) : track ? (
              <View style={[styles.player, layout.isWide && styles.playerWide]}>
                <View
                  style={[
                    styles.middleStack,
                    !layout.isWide && !scopeStageVisible && styles.middleStackCentered,
                    layout.isWide
                      ? { width: layout.leftPaneWidth, justifyContent: 'center' }
                      : {
                          height: layout.mediaStackHeight,
                          marginTop: layout.mediaTopMargin,
                          marginBottom: layout.mediaBottomGap,
                        },
                  ]}
                >
                  <Animated.View
                    style={[
                      styles.artButton,
                      artworkTransitionStyle,
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
                          source={{ uri: track.artworkData }}
                          style={styles.artImage}
                          contentFit="cover"
                          transition={reduceMotion ? null : 200}
                        />
                      ) : (
                        <AstraLogo size={Math.round(layout.artSize * 0.4)} />
                      )}
                    </View>
                  </Animated.View>

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
                        paused={!playerOpen || queueOpen}
                      />
                      <TactilePressable
                        onPress={() =>
                          useSettingsStore
                            .getState()
                            .setScopeMode(scopeMode === 'spectrum' ? 'scope' : 'spectrum')
                        }
                        haptic="selection"
                        hitSlop={12}
                        style={styles.scopeSwap} android_ripple={ripple.icon(24)}
                        accessibilityRole="button"
                        accessibilityLabel={`Showing ${
                          scopeMode === 'spectrum' ? 'spectrum' : 'oscilloscope'
                        }. Tap to switch.`}
                      >
                        <Text variant="caption" style={styles.scopeSwapLabel}>
                          {scopeMode === 'spectrum' ? 'SPECTRUM' : 'SCOPE'}
                        </Text>
                        <Ionicons name="swap-horizontal" size={14} color={colors.textTertiary} />
                      </TactilePressable>
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
                  <View style={styles.primaryControls}>
                    {lyricPeekEnabled ? (
                      <CachedLyricPeek
                        track={track}
                        active={playerOpen && !queueOpen}
                        hidden={
                          hasTabletCompanion && nowPlayingCompanion === 'lyrics'
                        }
                        onOpenLyrics={showLyrics}
                      />
                    ) : null}
                    <Animated.View
                      style={[
                        styles.trackInfo,
                        { marginBottom: layout.trackInfoGap },
                        metadataTransitionStyle,
                      ]}
                    >
                      <View style={styles.trackTextStack}>
                        <MarqueeText
                          variant="heading"
                          containerStyle={styles.trackTitle}
                          style={styles.trackTitleText}
                        >
                          {track.title}
                        </MarqueeText>
                        <View style={styles.trackMetaRow}>
                          {artistCreditTokens.map(({ artist, separator }) => (
                            <Fragment key={artist}>
                              <Pressable
                                onPress={() => navigateToArtist(artist, true)}
                                hitSlop={4}
                                style={styles.artistCreditButton}
                                android_ripple={ripple.bounded}
                                accessibilityRole="link"
                                accessibilityLabel={`View artist ${artist}`}
                              >
                                <Text variant="body" style={styles.artist}>
                                  {artist}
                                </Text>
                              </Pressable>
                              {separator ? (
                                <Text variant="body" style={styles.artistSeparator}>
                                  {separator}
                                </Text>
                              ) : null}
                            </Fragment>
                          ))}
                        </View>
                      </View>
                      <TactilePressable
                        hitSlop={10}
                        style={styles.inlineActionBtn} android_ripple={ripple.icon(22)}
                        haptic="light"
                        confirmationScale={1.08}
                        onPress={() => void toggleFavorite(track)}
                        accessibilityLabel={isFavorite ? 'Remove from favorites' : 'Add to favorites'}
                        accessibilityState={{ selected: isFavorite }}
                      >
                        <PlayerStateIcon
                          selected={isFavorite}
                          size={SUB_ICON_SIZE + 4}
                          inactive={
                            <Ionicons
                              name="heart-outline"
                              size={SUB_ICON_SIZE + 4}
                              color={colors.textTertiary}
                            />
                          }
                          active={
                            <Ionicons
                              name="heart"
                              size={SUB_ICON_SIZE + 4}
                              color={colors.accent}
                            />
                          }
                        />
                      </TactilePressable>
                    </Animated.View>

                    <WaveformSeekBar
                      active={playerOpen}
                      height={layout.waveformHeight}
                      touchPadding={WAVEFORM_TOUCH_PADDING}
                      trackPath={track.path}
                      onSeek={(seconds) => void seekTo(seconds)}
                    />

                    <View style={[styles.transport, { marginTop: layout.controlsGap }]}>
                      <TactilePressable
                        hitSlop={10}
                        style={styles.transportSideBtn} android_ripple={ripple.icon(24)}
                        haptic="selection"
                        onPress={() => void toggleShuffle()}
                        accessibilityLabel="Shuffle"
                        accessibilityState={{ selected: shuffle }}
                      >
                        <PlayerStateIcon
                          selected={shuffle}
                          size={SUB_ICON_SIZE + 2}
                          inactive={
                            <Ionicons name="shuffle" size={SUB_ICON_SIZE + 2} color={colors.textTertiary} />
                          }
                          active={
                            <Ionicons name="shuffle" size={SUB_ICON_SIZE + 2} color={colors.accent} />
                          }
                        />
                      </TactilePressable>
                      <TactilePressable
                        onPress={skipToPrevious}
                        haptic="light"
                        hitSlop={12}
                        style={styles.transportMainBtn} android_ripple={ripple.icon(26)}
                        accessibilityLabel="Previous"
                      >
                        <Ionicons
                          name="play-skip-back"
                          size={SKIP_ICON_SIZE}
                          color={colors.textPrimary}
                        />
                      </TactilePressable>
                      <TactilePressable
                        onPress={togglePlay}
                        haptic="light"
                        pressedScale={0.97}
                        hitSlop={12}
                        style={styles.playButton}
                        android_ripple={ripple.onAccent()}
                        accessibilityLabel={isPlaying ? 'Pause' : 'Play'}
                      >
                        <Ionicons
                          name={isLoading ? 'ellipsis-horizontal' : isPlaying ? 'pause' : 'play'}
                          size={PLAY_ICON_SIZE}
                          color={colors.bgPrimary}
                        />
                      </TactilePressable>
                      <TactilePressable
                        onPress={skipToNext}
                        haptic="light"
                        hitSlop={12}
                        style={styles.transportMainBtn} android_ripple={ripple.icon(26)}
                        accessibilityLabel="Next"
                      >
                        <Ionicons
                          name="play-skip-forward"
                          size={SKIP_ICON_SIZE}
                          color={colors.textPrimary}
                        />
                      </TactilePressable>
                      <TactilePressable
                        hitSlop={10}
                        style={styles.transportSideBtn} android_ripple={ripple.icon(24)}
                        haptic="selection"
                        onPress={() => void cycleRepeat()}
                        accessibilityLabel="Repeat"
                        accessibilityState={{ selected: repeat !== 'none' }}
                      >
                        <PlayerStateIcon
                          selected={repeat !== 'none'}
                          size={SUB_ICON_SIZE + 2}
                          inactive={
                            <Ionicons name="repeat" size={SUB_ICON_SIZE + 2} color={colors.textTertiary} />
                          }
                          active={repeat === 'one' ? (
                            <MaterialCommunityIcons
                              name="repeat-once"
                              size={SUB_ICON_SIZE + 2}
                              color={colors.accent}
                            />
                          ) : (
                            <Ionicons name="repeat" size={SUB_ICON_SIZE + 2} color={colors.accent} />
                          )}
                        />
                      </TactilePressable>
                    </View>
                  </View>

                  <View
                    style={[
                      styles.subRow,
                      layout.isWide
                        ? { marginTop: layout.controlsGap }
                        : styles.utilityFooter,
                    ]}
                  >
                    <View style={styles.subBadges}>
                      <RemoteSourceBadge sourceType={track.sourceType} />
                      <FormatBadges track={track} wrap={false} variant="plain" />
                    </View>
                    <View style={styles.subActions}>
                      <TactilePressable
                        hitSlop={10}
                        style={styles.subBtn} android_ripple={ripple.icon(20)}
                        haptic="selection"
                        onPress={() => void setScopeStageVisible(!scopeStageVisible)}
                        accessibilityLabel={scopeStageVisible ? 'Hide visualizer' : 'Show visualizer'}
                        accessibilityState={{ selected: scopeStageVisible }}
                      >
                        <PlayerStateIcon
                          selected={scopeStageVisible}
                          size={SUB_ICON_SIZE + 2}
                          inactive={
                            <MaterialCommunityIcons
                              name="sine-wave"
                              size={SUB_ICON_SIZE + 2}
                              color={colors.textTertiary}
                            />
                          }
                          active={
                            <MaterialCommunityIcons
                              name="sine-wave"
                              size={SUB_ICON_SIZE + 2}
                              color={colors.accent}
                            />
                          }
                        />
                      </TactilePressable>
                      <TactilePressable
                        hitSlop={10}
                        style={styles.subBtn} android_ripple={ripple.icon(20)}
                        haptic="selection"
                        onPress={showQueue}
                        accessibilityLabel="Queue"
                      >
                        <Ionicons
                          name="list-outline"
                          size={SUB_ICON_SIZE + 2}
                          color={colors.textTertiary}
                        />
                      </TactilePressable>
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
              </View>
              {tabletCompanionLayout ? (
                <View
                  style={[
                    styles.companionRegion,
                    { width: tabletCompanionLayout.companionWidth },
                  ]}
                >
                  <NowPlayingCompanionPane
                    active={playerOpen}
                    desktopTarget={isDesktopTarget}
                    track={track}
                  />
                </View>
              ) : null}
            </View>
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
                android_ripple={ripple.bounded}
                style={styles.menuItem}
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
      {queueOpen && !hasTabletCompanion && (
        isDesktopTarget ? (
          <RemoteQueueSheet onClose={closeQueue} />
        ) : (
          <QueueTray onClose={closeQueue} />
        )
      )}
      <PlaybackTargetPicker
        visible={targetPickerOpen}
        onClose={() => setTargetPickerOpen(false)}
      />
    </View>
  );
}

const useStyles = createThemedStyles((colors) => ({
  content: {
    flex: 1,
    backgroundColor: colors.bgPrimary,
    alignItems: 'center',
    // Clip the sheet to its own bounds. The NowPlayingWash bleeds up via negative
    // offsets to reach the true screen edges — fine at rest (this box is full-screen),
    // but while swiping the sheet down that overflow would spill above its top edge
    // onto the screen behind. Clipping contains the wash to the sheet in both states.
    overflow: 'hidden',
  },
  shell: {
    flex: 1,
  },
  playerBody: {
    flex: 1,
    minHeight: 0,
  },
  playerBodyTablet: {
    position: 'relative',
  },
  playerRegion: {
    flex: 1,
    minWidth: 0,
    alignItems: 'center',
  },
  playerRegionTablet: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    flexGrow: 0,
    flexShrink: 0,
  },
  playerCanvas: {
    flex: 1,
    minHeight: 0,
  },
  companionRegion: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    flexGrow: 0,
    flexShrink: 0,
    minHeight: 0,
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
  headerSide: {
    width: 68,
    flexDirection: 'row',
    alignItems: 'center',
  },
  headerActions: {
    justifyContent: 'flex-end',
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
    columnGap: NOW_PLAYING_WIDE_PANE_GAP,
  },
  middleStack: {
    width: '100%',
    alignItems: 'center',
  },
  middleStackCentered: {
    justifyContent: 'center',
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
    flexWrap: 'wrap',
    alignItems: 'center',
    marginTop: spacing.xs,
  },
  artistCreditButton: {
    alignSelf: 'flex-start',
  },
  artistSeparator: {
    color: colors.textTertiary,
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
  },
  primaryControls: {
    width: '100%',
  },
  utilityFooter: {
    marginTop: 'auto',
    paddingTop: spacing.lg,
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
  controlDisabled: {
    opacity: 0.35,
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
  statusPill: {
    minHeight: 28,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    borderRadius: radius.pill,
    backgroundColor: colors.glassBg,
    paddingHorizontal: spacing.sm,
  },
  statusDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
  },
  remoteDetail: {
    flex: 1,
    minWidth: 0,
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
  emptyTitle: {
    marginTop: spacing.lg,
  },
  emptyAction: {
    marginTop: spacing.lg,
    minHeight: 42,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
    backgroundColor: colors.glassBg,
  },
}));

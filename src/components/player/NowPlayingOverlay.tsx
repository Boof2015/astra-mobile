/* eslint-disable react-hooks/immutability, react-hooks/preserve-manual-memoization -- Reanimated gesture state is intentionally mutable, and the pan recognizer must retain identity across renders. */
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
  cancelAnimation,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSequence,
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
import { ScopeRack } from '@/components/player/ScopeRack';
import { NowPlayingCompanionPane } from '@/components/player/NowPlayingCompanionPane';
import { PlayerStateIcon } from '@/components/player/PlayerStateIcon';
import { CachedLyricPeek } from '@/components/player/CachedLyricPeek';
import {
  getNowPlayingTrackTransitionKey,
  NowPlayingTrackFadeThrough,
} from '@/components/player/nowPlayingTrackTransition';
import {
  resolveNowPlayingPanRelease,
  shouldEnableNowPlayingPan,
  shouldStartNowPlayingPan,
} from '@/components/player/nowPlayingDismiss';
import { useDelayedUnmountPresence } from '@/components/delayedPresence';
import {
  NOW_PLAYING_CLOSE_COMMIT_MS,
  NOW_PLAYING_OPEN_SETTLE_MS,
} from '@/components/renderPresenceTiming';
import { useAppForeground } from '@/lib/useAppForeground';
import { SleepTimerControls } from '@/components/player/SleepTimerControls';
import { AppSheet, AppSheetTitle } from '@/components/sheets/AppSheet';
import {
  radius,
  spacing,
} from '@/theme';
import {
  createThemedStyles,
  ScopedPaletteProvider,
  useColors,
} from '@/theme/themed';
import { useRipple } from '@/theme/ripple';
import { motion } from '@/theme/motion';
import { paletteWithAccent } from '@/theme/scopedAccent';
import { useNowPlayingArtworkAccent } from '@/theme/useNowPlayingArtworkAccent';
import {
  getNowPlayingLayout,
  getTabletCompanionLayout,
  NOW_PLAYING_CONTENT_BOTTOM_PADDING,
  NOW_PLAYING_CONTENT_TOP_PADDING,
  NOW_PLAYING_HEADER_HEIGHT,
  NOW_PLAYING_PLAY_BUTTON_SIZE,
  NOW_PLAYING_SCOPE_RAIL_BOTTOM_GAP,
  NOW_PLAYING_SUB_BUTTON_SIZE,
  NOW_PLAYING_WAVEFORM_TOUCH_PADDING,
  NOW_PLAYING_WIDE_PANE_GAP,
} from '@/components/player/nowPlayingLayout';
import { useReturnToTabs } from '@/navigation/returnToTabs';
import { resolveNavigationArtist } from '@/library/artistGrouping';
import {
  buildArtistNameTokens,
  parseArtistMetadata,
} from '@/shared/library/artistCredits';
import {
  artworkThumbFromSource,
  playerBackdropArtworkSource,
} from '@/library/artwork';
import { useLibraryStore } from '@/stores/libraryStore';
import { useDesktopRemoteStore } from '@/stores/desktopRemoteStore';
import { usePlayerStore } from '@/stores/playerStore';
import { useQueueStore } from '@/stores/queueStore';
import { usePlaylistStore } from '@/stores/playlistStore';
import { usePlaybackTargetStore } from '@/stores/playbackTargetStore';
import { usePlayerUiStore } from '@/stores/playerUiStore';
import { markNowPlayingTrackTransitionDirection } from '@/stores/nowPlayingTrackTransitionStore';
import { isPlayerOnScreen } from '@/stores/playerPresence';
import { useSettingsStore, type ScopeMode } from '@/stores/settingsStore';
import { useSleepTimerStore } from '@/stores/sleepTimerStore';
import { useThemeStore } from '@/stores/themeStore';
import type { DbTrack } from '@/types/library';
import {
  cycleRepeat,
  jumpToQueueIndex,
  seekTo,
  skipToNext,
  skipToPrevious,
  synchronizeVirtualQueueRevision,
  togglePlay,
  toggleShuffle
} from '@/audio/playbackController';
import {
  AstraQueue,
  toNativeQueuePalette,
} from '../../../modules/astra-library-scanner';
import {
  desktopConnectionLabel,
  getDesktopPlaybackPresentation,
  getEffectivePlaybackPresentation,
  getPhonePlaybackPresentation,
  hostFromBaseUrl,
} from '@/playback/playbackTargetPresentation';
import { formatSleepTimerStatus } from '@/audio/sleepTimerState';

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
const NOW_PLAYING_SPECTRUM_SMOOTHING = 0.85;
const PAN_DISMISS_HANDOFF_BACKSTOP_MS = 120;
const PAN_TOUCH_END_BACKSTOP_MS = 80;
const PAN_GESTURE_RECOVERY_MS = 1200;

interface NowPlayingMenuItem {
  key: string;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  onPress: () => void;
}

export function NowPlayingOverlay() {
  const appColors = useColors();
  const ripple = useRipple();
  const router = useRouter();
  const returnToTabs = useReturnToTabs();
  const insets = useSafeAreaInsets();
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const phase = usePlayerUiStore((s) => s.phase);
  const openRequest = usePlayerUiStore((s) => s.openRequest);
  const exitAnimated = usePlayerUiStore((s) => s.exitAnimated);
  const playerOpen = isPlayerOnScreen(phase);
  // Heavy scope/spectrum surfaces release their native backing in the
  // background. The overlay itself stays mounted — unmounting it mid-close used
  // to tear down the exit animation and strand the phase.
  const foreground = useAppForeground();
  const surfacesLive = playerOpen && foreground;
  const [queueOpen, setQueueOpen] = useState(false);
  const [lyricsBodySwitching, setLyricsBodySwitching] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [targetPickerOpen, setTargetPickerOpen] = useState(false);
  const [sleepTimerOpen, setSleepTimerOpen] = useState(false);
  const [playlistActionTrack, setPlaylistActionTrack] = useState<DbTrack | null>(null);
  const selectedTarget = usePlaybackTargetStore((s) => s.target);
  const themeIsDark = useThemeStore((s) => s.theme.isDark);
  const nowPlayingAccentSource = useThemeStore((s) => s.nowPlayingAccentSource);
  const coverArtAccentMethod = useThemeStore((s) => s.coverArtAccentMethod);
  const scopeMode = useSettingsStore((s) => s.scopeMode);
  const nativeQueueEnabled = useSettingsStore((s) => s.nativeQueueEnabled);
  const scopeStageVisible = useSettingsStore((s) => s.scopeStageVisible);
  const setScopeStageVisible = useSettingsStore((s) => s.setScopeStageVisible);
  const scopeStyle = useSettingsStore((s) => s.nowPlayingScopeStyle);
  const railStyle = scopeStyle === 'rail';
  const lyricsVisible = useSettingsStore((s) => s.lyricsVisible);
  const setLyricsVisible = useSettingsStore((s) => s.setLyricsVisible);
  const nowPlayingCompanion = useSettingsStore((s) => s.nowPlayingCompanion);
  const setNowPlayingCompanion = useSettingsStore((s) => s.setNowPlayingCompanion);
  const artistGroupingMode = useSettingsStore((s) => s.artistGroupingMode);
  const libraryTracks = useLibraryStore((s) => s.tracks);
  const track = usePlayerStore((s) => s.currentTrack);
  const playbackSource = useQueueStore((s) => s.source);
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
  const sleepTimer = useSleepTimerStore((s) => s.timer);
  const sleepRemainingMs = useSleepTimerStore((s) => s.remainingMs);
  void sleepRemainingMs;
  const phonePresentation = getPhonePlaybackPresentation({
    track,
    playbackState,
    source: playbackSource,
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
  const artworkIdentity = activePresentation.trackKey
    ? `${activePresentation.target}:${
        isDesktopTarget
          ? activePresentation.trackKey
          : track?.artworkHash ?? activePresentation.trackKey
      }`
    : null;
  const coverArtAccent = useNowPlayingArtworkAccent({
    enabled: playerOpen && nowPlayingAccentSource === 'cover-art',
    artworkUri: activePresentation.artworkUri,
    artworkIdentity,
    method: coverArtAccentMethod,
  });
  const colors = useMemo(
    () => paletteWithAccent(appColors, coverArtAccent, themeIsDark),
    [appColors, coverArtAccent, themeIsDark],
  );
  const styles = useStyles(colors);
  const effectiveScopeStageVisible = !isDesktopTarget && scopeStageVisible;
  // Backgrounding drops these two subtrees, which is what actually releases the
  // scope TextureViews and the decoded artwork. The overlay shell around them
  // deliberately stays mounted instead — dropping the whole tree used to tear
  // down the close animation mid-flight and strand the player unopenable.
  const renderScopeSurfaces = useDelayedUnmountPresence(
    effectiveScopeStageVisible,
    motion.snap.duration,
    !foreground
  );
  const renderArtworkFace = useDelayedUnmountPresence(
    railStyle || !effectiveScopeStageVisible,
    motion.snap.duration,
    !foreground
  );
  const activeTrack = desktopSnapshot?.currentTrack ?? null;
  const transitionTrackKey = getNowPlayingTrackTransitionKey(
    activePresentation.target,
    activePresentation.trackKey
  );
  const isPlaying = activePresentation.playbackState === 'playing';
  const isLoading = activePresentation.playbackState === 'loading';
  // Wash off a low-res thumbnail (like the album/artist detail headers do) so the
  // blur reads as pure colors — full-res art keeps its detail at any blur radius.
  // currentTrack only carries the full-size artworkData, so derive the thumb from it.
  const backdropArtworkUri = isDesktopTarget
    ? artworkThumbFromSource(activePresentation.artworkUri)
    : playerBackdropArtworkSource(track);
  const washArtworkUri = backdropArtworkUri;
  const availableHeight = windowHeight - insets.top - insets.bottom;
  const effectiveWidth = windowWidth - insets.left - insets.right;
  // The rack style swaps the art card's face in place, so only the rail style
  // reserves stage height for a scope strip below the art.
  const layoutScopeVisible = effectiveScopeStageVisible && railStyle;
  const standardLayout = getNowPlayingLayout(
    effectiveWidth,
    availableHeight,
    layoutScopeVisible
  );
  const tabletCompanionLayout = getTabletCompanionLayout(
    effectiveWidth,
    availableHeight,
    layoutScopeVisible
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
  const shellLeft =
    insets.left +
    contentPadding +
    Math.max(0, (effectiveWidth - contentPadding * 2 - shellWidth) / 2);
  const companionStartX = tabletCompanionLayout
    ? shellLeft + shellWidth - tabletCompanionLayout.companionWidth
    : Number.POSITIVE_INFINITY;
  const menuTop = insets.top + CONTENT_TOP_PADDING + HEADER_HEIGHT + spacing.xs;
  const libraryTrack = useMemo(
    () => (track ? libraryTracks.find((entry) => entry.path === track.path) ?? null : null),
    [libraryTracks, track]
  );
  const artistName = track
      ? resolveNavigationArtist(
        libraryTrack ?? {
          artist: track.artist,
          artist_names: track.artistNames,
          album_artist: track.albumArtist ?? null,
          album_artist_names: track.albumArtistNames,
        },
        artistGroupingMode
      )
    : '';
  const artistCreditTokens = useMemo(() => {
    if (!track) return [];
    if (track.artistNames && track.artistNames.length > 0) {
      return buildArtistNameTokens(track.artistNames);
    }
    return parseArtistMetadata(track.artist);
  }, [track]);
  const albumKey = track?.albumIdentityKey ?? libraryTrack?.album_identity_key;

  // The overlay stays mounted; open/close is this one shared value sliding the
  // sheet on the UI thread. The gesture itself is memoized below, so changing
  // child/body state updates these gates rather than replacing the recognizer.
  const translateY = useSharedValue(windowHeight);
  const panEnabled = useSharedValue(
    shouldEnableNowPlayingPan(playerOpen, queueOpen, lyricsBodySwitching)
  );
  const panDismissRequested = useSharedValue(false);
  const panRecoveryLease = useSharedValue(0);
  const screenHeight = useSharedValue(windowHeight);
  const companionTouchStartX = useSharedValue(companionStartX);
  const menuProgress = useSharedValue(0);
  // ∿ engagement, shared by both scope styles: rail = art shrink + strip fade,
  // rack = art face crossfading to the instrument rack. The presence gates keep
  // both faces for the 220 ms transition, then release the invisible surface.
  const stageProgress = useSharedValue(effectiveScopeStageVisible ? 1 : 0);

  const suspendPanForChildTransition = () => {
    panEnabled.value = false;
    panDismissRequested.value = false;
    cancelAnimation(panRecoveryLease);
    cancelAnimation(translateY);
    translateY.value = 0;
  };

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

  const showQueue = () => {
    if (hasTabletCompanion) {
      if (!isDesktopTarget) {
        void setLyricsVisible(false);
        void setNowPlayingCompanion('queue');
      }
      return;
    }
    suspendPanForChildTransition();
    setQueueOpen(true);
    if (nativeQueueEnabled && !isDesktopTarget) {
      void AstraQueue.present({ palette: toNativeQueuePalette(colors) }).catch((error) => {
        console.warn('[queue] native presentation failed', error);
        setQueueOpen(false);
      });
    }
  };

  const swapScopeMode = () =>
    useSettingsStore
      .getState()
      .setScopeMode(scopeMode === 'spectrum' ? 'scope' : 'spectrum');

  // The player is an overlay, so it can be open over a root-stack sibling of
  // `(tabs)` (e.g. desktop-remote). Going straight to a library route from there
  // diverges at the root stack and mints a second copy of the whole tab tree.
  const navigateToArtist = (targetArtist = artistName, credit = false) => {
    if (!targetArtist) return;
    // Slide the overlay away while the library detail loads underneath.
    dismissSheet();
    returnToTabs(
      {
        pathname: '/library/artist/[name]',
        params: { name: targetArtist, ...(credit ? { credit: '1' } : {}) },
      },
      'push'
    );
  };

  const navigateToAlbum = () => {
    if (!albumKey) return;
    dismissSheet();
    returnToTabs({ pathname: '/library/album/[key]', params: { key: albumKey } }, 'push');
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
  if (!isDesktopTarget) {
    menuItems.push({
      key: 'sleep-timer',
      label: sleepTimer ? `Sleep timer · ${formatSleepTimerStatus(sleepTimer)}` : 'Sleep timer',
      icon: 'moon-outline',
      onPress: () => {
        closeMenu();
        setSleepTimerOpen(true);
      },
    });
  }
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
  if (!isDesktopTarget) {
    menuItems.push({
      key: 'share-signal',
      label: 'Share as Signal',
      icon: 'pulse-outline',
      onPress: () => {
        closeMenu();
        dismissSheet();
        router.navigate('/signal' as never);
      },
    });
  }

  /**
   * Swapping the phone player body unmounts every normal control underneath the
   * parent pan detector. Suspend that pan for the commit frame and synchronously
   * restore its anchor first, so a cancelled child gesture cannot carry a stale
   * translateY into the lyrics tree (or back into the standard player).
   */
  const setPhoneLyricsVisible = (visible: boolean) => {
    if (!playerOpen) return;
    suspendPanForChildTransition();
    setLyricsBodySwitching(true);
    void setLyricsVisible(visible);
  };

  const showLyrics = () => {
    if (hasTabletCompanion) {
      void setNowPlayingCompanion('lyrics');
      return;
    }
    setPhoneLyricsVisible(!lyricsVisible);
  };

  useEffect(() => {
    if (!lyricsBodySwitching) return undefined;
    const frame = requestAnimationFrame(() => setLyricsBodySwitching(false));
    return () => cancelAnimationFrame(frame);
  }, [lyricsBodySwitching, lyricsMode]);

  useEffect(() => {
    panEnabled.value = shouldEnableNowPlayingPan(
      playerOpen,
      queueOpen,
      lyricsBodySwitching
    );
  }, [lyricsBodySwitching, panEnabled, playerOpen, queueOpen]);

  useEffect(() => {
    screenHeight.value = windowHeight;
  }, [screenHeight, windowHeight]);

  useEffect(() => {
    companionTouchStartX.value = companionStartX;
  }, [companionStartX, companionTouchStartX]);

  useEffect(() => {
    stageProgress.value = withTiming(effectiveScopeStageVisible ? 1 : 0, motion.snap);
  }, [effectiveScopeStageVisible, stageProgress]);
  const commitClosed = useCallback(
    () => usePlayerUiStore.getState().commitClosed(),
    []
  );
  /**
   * Enter the closing phase and drop the inner layers. Split out from
   * `dismissSheet` so the pan gesture can commit the phase without handing the
   * offset back to a fresh animation — it is already driving `translateY`.
   * Clearing the layers here rather than at the end also unpins the menu card,
   * which renders outside the translating content.
   */
  const beginDismiss = useCallback(() => {
    setMenuOpen(false);
    setQueueOpen(false);
    // `true`: this path drives the sheet away itself, so the effect below must
    // not overwrite the offset with a competing generic slide-out.
    usePlayerUiStore.getState().closePlayer(true);
  }, []);
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

  // Closing is a store transition, not navigation. The phase moves to `closing`
  // BEFORE the animation starts — a spring that gets cancelled never reports
  // completion, and depending on that callback is what used to leave the player
  // flagged open with the sheet parked off-screen, unopenable for the rest of
  // the session. The completion callback now only commits the release early;
  // a fallback timer commits it otherwise.
  const dismissSheet = (velocity = 0) => {
    beginDismiss();
    translateY.value = withSpring(
      windowHeight,
      {
        damping: 28,
        stiffness: 240,
        velocity,
        overshootClamping: true,
      },
      (finished) => {
        if (finished) runOnJS(commitClosed)();
      }
    );
  };

  // Enter animation. Keyed on `openRequest` as well as the phase, so asking for
  // a player that already believes it is open still re-runs the slide-in — that
  // is the recovery path for a sheet stranded off-screen by an interrupted
  // close. `queueOpen` re-anchors the player before its modal BottomSheet
  // appears, and `lyricsMode` provides the same backstop after the phone body
  // swap. `windowHeight` is deliberately NOT a dependency: a dimension change
  // (rotation, or an RN Modal like the output picker) would re-run this effect
  // and cancel an in-flight exit spring. NOTE: this effect must stay BELOW every
  // direct `translateY.value` write — the react compiler forbids mutations
  // after an effect that depends on the value.
  useEffect(() => {
    if (phase === 'closing') {
      // Gesture/button paths attach their own exit animation. Only animate here
      // when `closing` arrived from a direct closePlayer() call.
      if (!exitAnimated) {
        translateY.value = withTiming(windowHeight, { duration: 200 });
      }
      return;
    }
    translateY.value = withTiming(0, { duration: 240 });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- windowHeight excluded on purpose (see above)
  }, [
    phase,
    openRequest,
    exitAnimated,
    queueOpen,
    lyricsMode,
    translateY,
  ]);

  // `closing` → `closed`, and `opening` → `open`. Both are timers rather than
  // animation callbacks, so a cancelled animation can never strand the phase.
  // The store guards each transition, and this cleanup cancels a pending commit
  // if the user reopens mid-close. The store actions are read through getState
  // so this effect's identity never changes between playback ticks — a restarted
  // timer would mean the commit never lands.
  useEffect(() => {
    if (phase === 'closing') {
      const timer = setTimeout(
        () => usePlayerUiStore.getState().commitClosed(),
        NOW_PLAYING_CLOSE_COMMIT_MS
      );
      return () => clearTimeout(timer);
    }
    if (phase === 'opening') {
      const timer = setTimeout(
        () => usePlayerUiStore.getState().settleOpen(),
        NOW_PLAYING_OPEN_SETTLE_MS
      );
      return () => clearTimeout(timer);
    }
    return undefined;
  }, [phase, openRequest]);

  const dismissFromPan = useCallback(() => {
    // One JS transaction: the store enters `closing` before the deterministic
    // slide is scheduled. Its 220 ms duration always beats the 450 ms fallback
    // unmount, so a normal release cannot visibly despawn.
    beginDismiss();
    cancelAnimation(panRecoveryLease);
    cancelAnimation(translateY);
    translateY.value = withTiming(
      screenHeight.value,
      motion.snap,
      (finished) => {
        if (finished) runOnJS(commitClosed)();
      }
    );
  }, [beginDismiss, commitClosed, panRecoveryLease, screenHeight, translateY]);

  const pan = useMemo(
    () => Gesture.Pan()
      .activeOffsetY(14) // engage only on a downward drag
      .failOffsetY(-14)
      .failOffsetX([-24, 24]) // let the horizontal seek drag through
      .onTouchesDown((event, stateManager) => {
        const touchX = event.allTouches[0]?.absoluteX ?? Number.NaN;
        if (
          !shouldStartNowPlayingPan(
            panEnabled.value,
            touchX,
            companionTouchStartX.value
          )
        ) {
          stateManager.fail();
        }
      })
      .onTouchesMove((_event, stateManager) => {
        if (!panEnabled.value) stateManager.fail();
      })
      .onTouchesUp(() => {
        if (panDismissRequested.value) return;
        translateY.value = withDelay(
          PAN_TOUCH_END_BACKSTOP_MS,
          withTiming(0, motion.snap)
        );
      })
      .onTouchesCancelled(() => {
        if (panDismissRequested.value) return;
        translateY.value = withTiming(0, motion.snap);
      })
      .onStart(() => {
        panDismissRequested.value = false;
        cancelAnimation(translateY);
        cancelAnimation(panRecoveryLease);
        panRecoveryLease.value = withDelay(
          PAN_GESTURE_RECOVERY_MS,
          withTiming(panRecoveryLease.value + 1, { duration: 0 }, (finished) => {
            if (!finished || panDismissRequested.value) return;
            // This lease is independent of RNGH's terminal callbacks. If a
            // nested native gesture drops the handler, the partial drag still
            // repairs itself on the UI thread.
            translateY.value = withTiming(0, motion.snap);
          })
        );
      })
      .onUpdate((event) => {
        if (!panEnabled.value) {
          translateY.value = 0;
          return;
        }
        translateY.value = event.translationY > 0 ? event.translationY : 0;
      })
      .onEnd((event, success) => {
        const release = resolveNowPlayingPanRelease(
          event.translationY,
          event.velocityY,
          success && panEnabled.value
        );
        if (release === 'dismiss') {
          panDismissRequested.value = true;
          cancelAnimation(panRecoveryLease);
          // If the RN handoff is ever dropped, restore the partial drag instead
          // of leaving an open player stranded. dismissFromPan cancels this
          // delayed animation after synchronously entering `closing`.
          translateY.value = withDelay(
            PAN_DISMISS_HANDOFF_BACKSTOP_MS,
            withTiming(0, motion.snap)
          );
          runOnJS(dismissFromPan)();
          return;
        }
        panDismissRequested.value = false;
        cancelAnimation(panRecoveryLease);
        translateY.value = withTiming(0, motion.snap);
      })
      .onFinalize(() => {
        // Successful dismissals retain the short handoff backstop above. Every
        // other terminal path, including cancellation, re-anchors immediately.
        if (!panDismissRequested.value) {
          cancelAnimation(panRecoveryLease);
          translateY.value = withTiming(0, motion.snap);
        }
      }),
    [
      companionTouchStartX,
      dismissFromPan,
      panDismissRequested,
      panEnabled,
      panRecoveryLease,
      translateY,
    ]
  );

  // Stable identity: QueueTray is memo'd, so a fresh arrow here would defeat it.
  const closeQueue = useCallback(() => {
    suspendPanForChildTransition();
    if (nativeQueueEnabled && !isDesktopTarget) AstraQueue.dismiss();
    setQueueOpen(false);
    // Shared values and the state setter remain stable for this overlay mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDesktopTarget, nativeQueueEnabled]);

  useEffect(() => {
    if (!nativeQueueEnabled) return undefined;
    const dismissed = AstraQueue.addListener('onDismissed', () => {
      setQueueOpen(false);
    });
    const playbackRequest = AstraQueue.addListener('onPlaybackRequest', (request) => {
      void (async () => {
        try {
          const position = await AstraQueue.resolveEntryPosition(
            request.entryId,
            request.queueRevision,
          );
          if (position == null) {
            throw new Error('The queue changed. Try that song again.');
          }
          await jumpToQueueIndex(position, { virtualPosition: true });
          AstraQueue.resolvePlaybackRequest(request.requestId, true);
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Could not play that song';
          AstraQueue.resolvePlaybackRequest(request.requestId, false, message);
        }
      })();
    });
    const revision = AstraQueue.addListener('onQueueRevision', (event) => {
      void synchronizeVirtualQueueRevision(
        event.queueRevision,
        event.activePosition,
      ).catch((error) => {
        console.warn('[queue] transport revision sync failed', error);
      });
    });
    return () => {
      dismissed.remove();
      playbackRequest.remove();
      revision.remove();
    };
  }, [nativeQueueEnabled]);

  // `colors` is accent-scoped to the cover art, so it changes on every track
  // change. present() captured the palette once, which left an open sheet
  // wearing the previous track's accent.
  useEffect(() => {
    if (!nativeQueueEnabled || isDesktopTarget || !queueOpen) return;
    AstraQueue.updatePalette(toNativeQueuePalette(colors));
  }, [colors, isDesktopTarget, nativeQueueEnabled, queueOpen]);

  // Hardware back, innermost layer first: menu → queue tray → player. Registered
  // only while open, so it sits above the focused screen's own handlers (LIFO)
  // — e.g. the library-detail back interceptor underneath.
  useEffect(() => {
    if (!playerOpen) return undefined;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (menuOpen) {
        closeMenu();
        return true;
      }
      if (targetPickerOpen) {
        setTargetPickerOpen(false);
        return true;
      }
      if (sleepTimerOpen) {
        setSleepTimerOpen(false);
        return true;
      }
      if (playlistActionTrack) {
        setPlaylistActionTrack(null);
        return true;
      }
      if (queueOpen) {
        closeQueue();
        return true;
      }
      dismissSheet();
      return true;
    });
    return () => sub.remove();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- closeMenu/dismissSheet are re-created every render; re-subscribing on each would thrash the LIFO chain. windowHeight is listed because dismissSheet captures it.
  }, [
    playerOpen,
    menuOpen,
    targetPickerOpen,
    sleepTimerOpen,
    playlistActionTrack,
    queueOpen,
    closeQueue,
    windowHeight,
  ]);

  const contentStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }],
  }));

  const menuLayerStyle = useAnimatedStyle(() => ({
    opacity: menuProgress.value,
  }));

  const menuCardStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: MENU_ENTER_OFFSET_Y * (1 - menuProgress.value) }],
  }));

  // Rail choreography (standard presentation only): the art box is laid out at
  // its scope-off size and driven to the scope-on size/position by
  // stageProgress, so the ∿ toggle animates as one move instead of snapping
  // layout. Wide windows keep the in-flow snap — their stage height is
  // state-dependent by design.
  const railChoreographed = railStyle && !layout.isWide && !isDesktopTarget;
  const artBoxSize = railChoreographed ? layout.artSizeScopeOff : layout.artSize;
  const railArtScale =
    railChoreographed && layout.artSizeScopeOff > 0
      ? layout.artSizeScopeOn / layout.artSizeScopeOff
      : 1;
  const railArtShift = railChoreographed
    ? layout.artSizeScopeOn / 2 - layout.mediaStackHeight / 2
    : 0;
  const artStageTransitionStyle = useAnimatedStyle(() => ({
    transform: [
      { translateY: stageProgress.value * railArtShift },
      {
        scale: 1 + stageProgress.value * (railArtScale - 1),
      },
    ],
  }));
  const railSurfaceStyle = useAnimatedStyle(() => ({
    opacity: stageProgress.value,
    transform: [{ translateY: (1 - stageProgress.value) * 10 }],
  }));
  // Rack face flip: the art face fades out while the instrument rack settles in.
  const rackFaceStyle = useAnimatedStyle(() => ({
    opacity: stageProgress.value,
    transform: [{ scale: 0.98 + stageProgress.value * 0.02 }],
  }));
  // Always write the artwork opacity. Removing an animated style after Rack
  // faded it to zero leaves that native value behind until the view remounts.
  // Rail therefore explicitly restores the face instead of relying on the
  // absence of Rack's fade style.
  const artFaceStyle = useAnimatedStyle(
    () => ({
      opacity: railStyle ? 1 : 1 - stageProgress.value,
    }),
    [railStyle]
  );

  return (
    <ScopedPaletteProvider colors={colors}>
    <View style={StyleSheet.absoluteFill} pointerEvents={playerOpen ? 'box-none' : 'none'}>
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
                active={surfacesLive}
                isPlaying={isPlaying}
                isLoading={isLoading}
                isFavorite={isFavorite}
                onSeek={(seconds) => void seekTo(seconds)}
                onPlayPause={togglePlay}
                onNext={skipToNext}
                onPrev={skipToPrevious}
                onToggleFavorite={() => void toggleFavorite(track)}
                onExitLyrics={() => setPhoneLyricsVisible(false)}
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
                    <NowPlayingTrackFadeThrough
                      transitionKey={transitionTrackKey}
                      style={[
                        styles.artCard,
                        {
                          width: layout.artSize,
                          height: layout.artSize,
                        },
                      ]}
                      contentStyle={styles.trackVisualLayer}
                    >
                      {activePresentation.artworkUri ? (
                        <Image
                          source={{ uri: activePresentation.artworkUri }}
                          style={styles.artImage}
                          contentFit="cover"
                        />
                      ) : (
                        <AstraLogo size={Math.round(layout.artSize * 0.4)} />
                      )}
                    </NowPlayingTrackFadeThrough>
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
                    <NowPlayingTrackFadeThrough
                      transitionKey={transitionTrackKey}
                      style={styles.trackInfoFrame}
                      contentStyle={[
                        styles.trackInfo,
                        { marginBottom: layout.trackInfoGap },
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
                        haptic={activeTrack.isFavorite ? 'toggleOff' : 'toggleOn'}
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
                    </NowPlayingTrackFadeThrough>

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
                        haptic={desktopSnapshot?.shuffle ? 'toggleOff' : 'toggleOn'}
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
                        onPress={() => {
                          markNowPlayingTrackTransitionDirection('previous', 'desktop');
                          void sendDesktopControl('previous');
                        }}
                        haptic="action"
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
                        haptic="action"
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
                        onPress={() => {
                          markNowPlayingTrackTransitionDirection('next', 'desktop');
                          void sendDesktopControl('next');
                        }}
                        haptic="action"
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
                        haptic="modeCycle"
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
                      styles.artButton,
                      artStageTransitionStyle,
                      {
                        width: artBoxSize,
                        height: artBoxSize,
                      },
                    ]}
                  >
                    <Animated.View
                      style={[
                        styles.artCard,
                        artFaceStyle,
                        {
                          width: artBoxSize,
                          height: artBoxSize,
                        },
                      ]}
                    >
                      {renderArtworkFace ? (
                        <NowPlayingTrackFadeThrough
                          transitionKey={transitionTrackKey}
                          style={StyleSheet.absoluteFill}
                          contentStyle={styles.trackVisualLayer}
                        >
                          {track.artworkData ? (
                            <Image
                              source={{ uri: track.artworkData }}
                              style={styles.artImage}
                              contentFit="cover"
                              cachePolicy="disk"
                              allowDownscaling
                            />
                          ) : (
                            <AstraLogo size={Math.round(artBoxSize * 0.4)} />
                          )}
                        </NowPlayingTrackFadeThrough>
                      ) : null}
                    </Animated.View>
                    {!railStyle && renderScopeSurfaces && (
                      <Animated.View
                        pointerEvents="none"
                        style={[styles.rackFace, rackFaceStyle]}
                      >
                        <ScopeRack
                          size={artBoxSize}
                          stripWidth={layout.scopeWidth}
                          transitionKey={transitionTrackKey}
                          artworkUri={backdropArtworkUri}
                          spectrumSmoothing={NOW_PLAYING_SPECTRUM_SMOOTHING}
                          paused={!surfacesLive || queueOpen || !effectiveScopeStageVisible}
                        />
                      </Animated.View>
                    )}
                  </Animated.View>

                  {railStyle && !layout.isWide && renderScopeSurfaces && (
                    <Animated.View
                      pointerEvents={effectiveScopeStageVisible ? 'auto' : 'none'}
                      style={[
                        styles.scopeRailFloating,
                        railSurfaceStyle,
                        {
                          width: layout.scopeWidth,
                          height: layout.scopeHeight,
                          bottom: NOW_PLAYING_SCOPE_RAIL_BOTTOM_GAP,
                        },
                      ]}
                    >
                      <ScopeRail
                        width={layout.scopeWidth}
                        height={layout.scopeHeight}
                        mode={scopeMode}
                        paused={!surfacesLive || queueOpen || !effectiveScopeStageVisible}
                        revealed={effectiveScopeStageVisible}
                        onSwap={swapScopeMode}
                      />
                    </Animated.View>
                  )}
                  {railStyle && layout.isWide && renderScopeSurfaces && (
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
                      <ScopeRail
                        width={layout.scopeWidth}
                        height={layout.scopeHeight}
                        mode={scopeMode}
                        paused={!surfacesLive || queueOpen || !effectiveScopeStageVisible}
                        revealed={effectiveScopeStageVisible}
                        onSwap={swapScopeMode}
                      />
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
                        active={surfacesLive && !queueOpen}
                        hidden={
                          hasTabletCompanion && nowPlayingCompanion === 'lyrics'
                        }
                        onOpenLyrics={showLyrics}
                      />
                    ) : null}
                    <NowPlayingTrackFadeThrough
                      transitionKey={transitionTrackKey}
                      style={styles.trackInfoFrame}
                      contentStyle={[
                        styles.trackInfo,
                        { marginBottom: layout.trackInfoGap },
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
                        haptic={isFavorite ? 'toggleOff' : 'toggleOn'}
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
                    </NowPlayingTrackFadeThrough>

                    <WaveformSeekBar
                      active={surfacesLive}
                      height={layout.waveformHeight}
                      touchPadding={WAVEFORM_TOUCH_PADDING}
                      trackPath={track.path}
                      onSeek={(seconds) => void seekTo(seconds)}
                    />

                    <View style={[styles.transport, { marginTop: layout.controlsGap }]}>
                      <TactilePressable
                        hitSlop={10}
                        style={styles.transportSideBtn} android_ripple={ripple.icon(24)}
                        haptic={shuffle ? 'toggleOff' : 'toggleOn'}
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
                        haptic="action"
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
                        haptic="action"
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
                        haptic="action"
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
                        haptic="modeCycle"
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
                        haptic={scopeStageVisible ? 'toggleOff' : 'toggleOn'}
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
                      <TactilePressable
                        hitSlop={10}
                        style={styles.subBtn} android_ripple={ripple.icon(20)}
                        haptic="selection"
                        onPress={showLyrics}
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
                          size={SUB_ICON_SIZE + 2}
                          inactive={
                            <MaterialCommunityIcons
                              name="script-text-outline"
                              size={SUB_ICON_SIZE + 2}
                              color={colors.textTertiary}
                            />
                          }
                          active={
                            <MaterialCommunityIcons
                              name="script-text-outline"
                              size={SUB_ICON_SIZE + 2}
                              color={colors.accent}
                            />
                          }
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
                    active={surfacesLive}
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
      {sleepTimerOpen ? (
        <AppSheet onClose={() => setSleepTimerOpen(false)}>
          <AppSheetTitle title="Sleep timer" subtitle={sleepTimer ? formatSleepTimerStatus(sleepTimer) : undefined} />
          <SleepTimerControls />
        </AppSheet>
      ) : null}
      {queueOpen && !hasTabletCompanion && (
        isDesktopTarget ? (
          <RemoteQueueSheet onClose={closeQueue} />
        ) : !nativeQueueEnabled ? (
          <QueueTray onClose={closeQueue} />
        ) : null
      )}
      <PlaybackTargetPicker
        visible={targetPickerOpen}
        onClose={() => setTargetPickerOpen(false)}
      />
    </View>
    </ScopedPaletteProvider>
  );
}

interface ScopeRailProps {
  width: number;
  height: number;
  mode: ScopeMode;
  paused: boolean;
  /** Whether the rail is currently shown — drives the transient label hint. */
  revealed: boolean;
  onSwap: () => Promise<void>;
}

/**
 * Rail-style scope strip. The whole surface swaps SPECTRUM ⇄ SCOPE on tap; the
 * mode label only appears transiently (on reveal and on swap) so the rail reads
 * as an instrument, not a labelled widget.
 */
function ScopeRail({ width, height, mode, paused, revealed, onSwap }: ScopeRailProps) {
  const styles = useStyles();
  const colors = useColors();
  const labelOpacity = useSharedValue(0);
  // Swap presses bump the nonce; the flash itself lives in the effect because
  // the compiler forbids direct shared-value writes after an effect uses one.
  const [flashNonce, setFlashNonce] = useState(0);

  useEffect(() => {
    if (!revealed) return;
    void flashNonce;
    labelOpacity.value = withSequence(
      withTiming(1, { duration: 160 }),
      withDelay(1400, withTiming(0, { duration: 420 }))
    );
  }, [flashNonce, labelOpacity, revealed]);
  const labelStyle = useAnimatedStyle(() => ({ opacity: labelOpacity.value }));

  return (
    <TactilePressable
      onPress={() => {
        void onSwap();
        setFlashNonce((n) => n + 1);
      }}
      haptic="selection"
      pressedScale={0.99}
      style={[styles.scopeRailSurface, { width, height }]}
      accessibilityRole="button"
      accessibilityLabel={`Showing ${
        mode === 'spectrum' ? 'spectrum' : 'oscilloscope'
      }. Tap to switch.`}
    >
      <Visualizer
        width={width}
        height={height}
        interactive={false}
        showChrome={false}
        mode={mode}
        edgeFade
        spectrumSmoothing={NOW_PLAYING_SPECTRUM_SMOOTHING}
        paused={paused}
      />
      <Animated.View pointerEvents="none" style={[styles.scopeSwap, labelStyle]}>
        <Text variant="caption" style={styles.scopeSwapLabel}>
          {mode === 'spectrum' ? 'SPECTRUM' : 'SCOPE'}
        </Text>
        <Ionicons name="swap-horizontal" size={14} color={colors.textTertiary} />
      </Animated.View>
    </TactilePressable>
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
    color: colors.textSecondary,
    letterSpacing: 1.5,
    fontSize: 10,
  },
  source: {
    color: colors.textPrimary,
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
  // Standard-presentation rail: pinned to the stage bottom so it can stay
  // mounted (and positioned) while its reveal animates. The parent's
  // alignItems centers it horizontally.
  scopeRailFloating: {
    position: 'absolute',
    overflow: 'hidden',
  },
  scopeRailSurface: {
    justifyContent: 'center',
  },
  // Rack-style face over the art card frame. Deliberately unclipped: the
  // backdrop rounds/clips itself, while the strips overflow the card.
  rackFace: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
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
  trackVisualLayer: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  trackInfoFrame: {
    alignSelf: 'stretch',
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

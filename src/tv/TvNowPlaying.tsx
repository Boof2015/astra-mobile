import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Keyboard, StyleSheet, View } from 'react-native';
import Animated, { cancelAnimation, Easing, LayoutAnimationConfig, useAnimatedStyle, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { useThemeStore } from '@/stores/themeStore';
import { usePlayerStore } from '@/stores/playerStore';
import { usePlaylistStore } from '@/stores/playlistStore';
import { usePlayerUiStore } from '@/stores/playerUiStore';
import { useLyricsStore } from '@/stores/lyricsStore';
import { useLyricsSettingsStore } from '@/stores/lyricsSettingsStore';
import { useSleepTimerStore } from '@/stores/sleepTimerStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { cycleRepeat, seekTo, skipToNext, skipToPrevious, togglePlay, toggleShuffle } from '@/audio/playbackController';
import { playerBackdropArtworkSource } from './artwork';
import { getNativeSetting, setNativeSetting } from '@/db/nativeSettings';
import { hasRenderableSyncedLines } from '@/lyrics/presentation';
import { SignalCode } from '@/components/signal/SignalCode';
import { signalLayoutFromTrack } from '@/audio/signalShare';
import { SpectrumCurve } from '@/components/SpectrumCurve';
import { rgbToOklab } from '@/theme/adaptiveAccent';
import { hexToRgb } from '@/theme/colorUtils';
import { oklchToHex } from '@/theme/artworkField';
import { OscilloscopeWave } from '@/components/OscilloscopeWave';
import { RepeatFlowIcon, ShuffleForkIcon } from '@/components/player/DrawnTransportIcons';
import { useNowPlayingArtworkColors } from '@/theme/useNowPlayingArtworkColors';
import { formatSleepTimerRemaining } from '@/audio/sleepTimerState';
import { AstraLibraryData } from '../../modules/astra-library-scanner';
import { resolveNavigationArtist } from '@/library/artistGrouping';
import type { DbTrack } from '@/types/library';
import type { Track } from '@/types/audio';
import type { TvDirection, TvDirectionPress } from '../../modules/astra-tv';
import { TvAtmosphere } from './TvAtmosphere';
import { TvButton, TvFocusRegion, useTvActive, useTvFocus } from './TvFocus';
import { TvPanel, type TvMenu } from './TvPanel';
import { TvNameFlow } from './TvNameFlow';
import { box, TvArtwork, TvText } from './TvPrimitives';
import { useTvBackHandler } from './TvBack';
import { useTvTheme } from './useTvTheme';
import { TvPlayerWaveform, TvPlayerHairline } from './TvPlayerWaveform';
import { TvPlayerLyrics } from './TvPlayerLyrics';
import { TvPlayerQueue } from './TvPlayerQueue';
import { useTvPlayerPresentation } from './useTvPlayerPresentation';
import { playerNeighbor, playerTime, seekPreview, restorePlayerPresentation, playerViewWithVisualizer, type PlayerControl, type TvPlayerView, type TvVisualizer } from './nowPlayingModel';
import { albumFromTrack } from './TvBrowse';
import type { TvDetail, TvRun } from './tvCollections';
import { tvEnter, tvExit, tvLayout, tvLyricsEnter, tvLyricsExit, tvLyricsLayout, tvPanelEnter, useTvPlayerTransition } from './TvTransitions';

const VIEW_KEY = 'tv_now_playing_view_v1';
const VISUALIZER_KEY = 'tv_now_playing_visualizer_v1';
const bottomControls: PlayerControl[] = ['previous', 'next', 'shuffle', 'repeat', 'lyrics', 'queue', 'more'];

export function TvNowPlaying({ run, openDetail }: { run: TvRun; openDetail: (detail: TvDetail) => void }) {
  const tv = useTvTheme();
  const active = useTvActive();
  const commitClosed = usePlayerUiStore(s => s.commitClosed);
  const [atmosphereReady, setAtmosphereReady] = useState(false);
  const revealAtmosphere = useCallback(() => {
    const phase = usePlayerUiStore.getState().phase;
    if (phase === 'opening' || phase === 'open') setAtmosphereReady(true);
  }, []);
  const pageStyle = useTvPlayerTransition(active, commitClosed, revealAtmosphere);
  const { request, focused } = useTvFocus();
  const track = usePlayerStore(s => s.currentTrack);
  const playing = usePlayerStore(s => s.playbackState === 'playing');
  const shuffle = usePlayerStore(s => s.shuffle);
  const repeat = usePlayerStore(s => s.repeat);
  const sleepTimer = useSleepTimerStore(s => s.timer);
  const favorite = usePlaylistStore(s => !!track && s.favoritePaths.has(track.path));
  const artworkAccent = useThemeStore(s => s.nowPlayingAccentSource === 'cover-art');
  const [viewChoice, setView] = useState<TvPlayerView>('cover');
  const [visualizer, setVisualizer] = useState<TvVisualizer>('spectrum');
  const [automaticLyrics, setAutomaticLyrics] = useState(true);
  const [preview, setPreview] = useState<{ path: string; time: number } | null>(null);
  const [queue, setQueue] = useState(false);
  const [menus, setMenus] = useState<TvMenu[]>([]);
  const [signal, setSignal] = useState<Track | null>(null);
  const [customTimer, setCustomTimer] = useState(false);
  const [node, setNode] = useState<View | null>(null);
  const storedMenu = menus.at(-1);
  const menu = useMemo(() => storedMenu?.title === 'Now playing' ? { ...storedMenu, items: storedMenu.items.map((item, i) => i === 1 ? { ...item, label: sleepTimer ? `Sleep timer · ${formatSleepTimerRemaining(sleepTimer, useSleepTimerStore.getState().remainingMs)}` : 'Sleep timer' } : item) } : storedMenu, [storedMenu, sleepTimer]);
  const overlay = !!menu || queue || !!signal || customTimer;
  const effectivePreview = preview?.path === track?.path ? preview?.time ?? null : null;
  const { idle, interact, foreground, reduced } = useTvPlayerPresentation(playing, overlay || effectivePreview !== null || focused === 'np:plain', node);
  const playLaidOut = useRef(false);
  const lastControl = useRef('np:play');
  const lastBottom = useRef<PlayerControl>('previous');
  const changedView = useRef(false);
  const mounted = useRef(true);
  const lyrics = useLyricsStore(s => track ? s.byPath[track.path] : undefined);
  const plainLyrics = lyrics?.result?.status === 'hit' && !hasRenderableSyncedLines(lyrics.result.lyrics.syncedLines) && !!lyrics.result.lyrics.plainLyrics;
  const view = viewChoice === 'lyrics' && automaticLyrics && lyrics?.result?.status === 'not_found' ? 'cover' : viewChoice;
  const split = view === 'lyrics';
  const compact = view === 'visualizer';
  // More retains its action callbacks while a child picker opens and closes.
  // Those actions must read the latest committed presentation, not the values
  // captured when More first opened (including the picker's checked/focus row).
  const presentation = useRef({ viewChoice, visualizer, split });
  useLayoutEffect(() => { presentation.current = { viewChoice, visualizer, split }; }, [viewChoice, visualizer, split]);
  useEffect(() => {
    if (active) {
      lastControl.current = 'np:play';
      lastBottom.current = 'previous';
      interact();
      usePlayerUiStore.getState().settleOpen();
      request('np:play');
    }
  }, [active, interact, request]);
  useEffect(() => {
    mounted.current = true;
    void Promise.all([getNativeSetting(VIEW_KEY), getNativeSetting(VISUALIZER_KEY)]).then(([value, mode]) => {
      if (!mounted.current || changedView.current) return;
      const restored = restorePlayerPresentation(value, mode);
      setView(restored.view); setVisualizer(restored.visualizer);
    });
    void useSleepTimerStore.getState().hydrate();
    return () => { mounted.current = false; };
  }, [request]);
  useEffect(() => { if (track) void useLyricsStore.getState().loadForTrack(track); }, [track]);
  useEffect(() => usePlayerStore.subscribe((next, previous) => {
    if (next.currentTrack?.path !== previous.currentTrack?.path) setPreview(null);
  }), []);
  useEffect(() => {
    if (!active) return;
    if (idle) { request('np:idle'); return; }
    if (!overlay && focused === 'np:idle') request(lastControl.current);
  }, [active, idle, overlay, focused, request]);
  const changeView = (next: TvPlayerView) => {
    changedView.current = true; setAutomaticLyrics(false); setView(next); interact();
    run(() => setNativeSetting(VIEW_KEY, next));
  };
  const closeMenu = useCallback(() => {
    if (!menu) return;
    setMenus(previous => previous.slice(0, -1)); request(menu.opener); interact();
  }, [menu, request, interact]);
  const closeQueue = () => { setQueue(false); request('np:queue'); interact(); };
  const closeSignal = () => { setSignal(null); request(menu ? `menu:${menu.selected ?? 0}` : 'np:more'); interact(); };
  useTvBackHandler(active, () => {
    if (customTimer) { if (Keyboard.isVisible()) Keyboard.dismiss(); else { setCustomTimer(false); request('menu:7'); interact(); } return true; }
    if (signal) { closeSignal(); return true; }
    if (menu) { closeMenu(); return true; }
    if (queue) return false; // Queue's later handler owns its panel/reorder.
    if (effectivePreview !== null) { setPreview(null); interact(); request('np:seek'); return true; }
    if (focused === 'np:plain') { interact(); request('np:seek'); return true; }
    return false;
  });
  const pushMenu = (next: TvMenu, parentIndex?: number) => {
    interact();
    setMenus(previous => [...previous.map((item, i) => i === previous.length - 1 && parentIndex != null ? { ...item, selected: parentIndex } : item), next]);
  };
  const actionDone = () => { setMenus([]); interact(); request('np:more'); };
  const sleepMenu = () => {
    const timer = useSleepTimerStore.getState().timer;
    pushMenu({ title: 'Sleep timer', opener: 'menu:1', left: split ? 210 : 650, top: 150, items: [
      { label: 'Off', selected: !timer, run: () => run(() => useSleepTimerStore.getState().cancel()) },
      ...[15, 30, 45, 60, 90].map(minutes => ({ label: `${minutes} minutes`, run: () => run(() => useSleepTimerStore.getState().startMinutes(minutes), `Sleep timer · ${minutes} minutes`) })),
      { label: 'End of track', selected: timer?.mode === 'end-of-track', run: () => run(() => useSleepTimerStore.getState().startEndOfTrack(), 'Sleep timer · End of track') },
      { label: 'Custom…', keepOpen: true, run: () => { setCustomTimer(true); } },
    ] }, 1);
  };
  const visualizerMenu = () => {
    const modes: TvVisualizer[] = ['off', 'oscilloscope', 'spectrum'];
    const current = presentation.current;
    pushMenu({ title: 'Visualizer', opener: 'menu:0', selected: modes.indexOf(current.visualizer), left: current.split ? 210 : 650, top: 270,
      items: modes.map((mode, i) => ({ label: ['Off', 'Oscilloscope', 'Spectrum'][i], selected: current.visualizer === mode, run: () => {
        changedView.current = true;
        setVisualizer(mode);
        changeView(playerViewWithVisualizer(presentation.current.viewChoice, mode));
        run(() => setNativeSetting(VISUALIZER_KEY, mode));
      } })),
    }, 0);
  };
  const lyricsMenu = () => {
    const settings = useLyricsSettingsStore.getState();
    pushMenu({ title: 'Lyrics options', opener: 'menu:5', left: split ? 210 : 650, top: 240, items: [
      { label: `Word timing · ${settings.wordTimingEnabled ? 'On' : 'Off'}`, run: () => run(() => settings.setWordTimingEnabled(!settings.wordTimingEnabled)) },
      { label: `Furigana · ${settings.furiganaEnabled ? 'On' : 'Off'}`, run: () => run(() => settings.setFuriganaEnabled(!settings.furiganaEnabled)) },
      { label: `Translations · ${settings.translationsEnabled ? 'On' : 'Off'}`, run: () => run(() => settings.setTranslationsEnabled(!settings.translationsEnabled)) },
      { label: `Voice labels · ${settings.voiceLabelsEnabled ? 'On' : 'Off'}`, run: () => run(() => settings.setVoiceLabelsEnabled(!settings.voiceLabelsEnabled)) },
      { label: 'Reload lyrics', run: () => { if (track) run(() => useLyricsStore.getState().loadForTrack(track, { force: true })); } },
    ] }, 5);
  };
  const goTo = (kind: 'album' | 'artist') => {
    if (!track) return;
    run(async () => {
      const dbTrack = await AstraLibraryData.getTrack<DbTrack>(track.path);
      if (!dbTrack) throw new Error('This track is not in your library.');
      if (!mounted.current) return;
      actionDone();
      if (kind === 'album') openDetail({ kind: 'album', album: albumFromTrack(dbTrack) });
      else {
        const artist = resolveNavigationArtist(dbTrack, useSettingsStore.getState().artistGroupingMode);
        openDetail({ kind: 'artist', artist: { artist, track_count: 0, primary_track_count: 0, album_count: 0, artwork_hash: dbTrack.artwork_hash, artwork_source: 'track', artwork_hashes: dbTrack.artwork_hash ? [dbTrack.artwork_hash] : [] } });
      }
    });
  };
  const more = () => {
    const state = useSleepTimerStore.getState();
    pushMenu({ title: 'Now playing', opener: 'np:more', left: split ? 210 : 650, top: 155, items: [
      { label: 'Visualizer', icon: 'pulse', keepOpen: true, run: visualizerMenu },
      { label: state.timer ? `Sleep timer · ${formatSleepTimerRemaining(state.timer, state.remainingMs)}` : 'Sleep timer', icon: 'moon-outline', keepOpen: true, run: sleepMenu },
      { label: 'Go to album', icon: 'disc-outline', run: () => goTo('album') },
      { label: 'Go to artist', icon: 'person-outline', run: () => goTo('artist') },
      { label: 'Show Signal', icon: 'barcode-outline', keepOpen: true, run: () => { setMenus(previous => previous.map((item, i) => i === previous.length - 1 ? { ...item, selected: 4 } : item)); setSignal(track); request('np:signal:done'); } },
      { label: 'Lyrics options…', materialIcon: 'comment-quote-outline', keepOpen: true, run: lyricsMenu },
    ] });
  };
  const controlFocus = (control: PlayerControl) => {
    lastControl.current = `np:${control}`;
    if (bottomControls.includes(control)) lastBottom.current = control;
    interact();
  };
  const direction = (control: PlayerControl, d: TvDirection, press: TvDirectionPress) => {
    interact();
    if (control === 'seek' && effectivePreview !== null && track) {
      if (d === 'left' || d === 'right') setPreview(previous => ({ path: track.path, time: seekPreview(previous?.time ?? effectivePreview, usePlayerStore.getState().duration, d, press.heldMs, press.repeat) }));
      return;
    }
    if (split && plainLyrics && d === 'right' && (control === 'seek' || control === 'favorite' || control === 'repeat' || control === 'more')) { request('np:plain'); return; }
    request(`np:${playerNeighbor(control, d, split, lastBottom.current)}`);
  };
  const pressSeek = () => {
    interact();
    if (!track) return;
    const player = usePlayerStore.getState();
    if (effectivePreview === null) {
      if (player.duration > 0) setPreview({ path: track.path, time: Math.min(player.duration, player.pendingSeek?.target ?? player.currentTime) });
    } else {
      const path = track.path; const time = effectivePreview;
      setPreview(null); run(async () => { if (usePlayerStore.getState().currentTrack?.path === path) await seekTo(time); });
    }
  };
  const stageDrift = useSharedValue(0);
  useEffect(() => {
    if (idle && !reduced && foreground) stageDrift.value = withRepeat(withTiming(1, { duration: 50000, easing: Easing.inOut(Easing.sin) }), -1, true);
    else { cancelAnimation(stageDrift); stageDrift.value = withTiming(0, { duration: reduced ? 0 : 500 }); }
    return () => cancelAnimation(stageDrift);
  }, [idle, reduced, foreground, stageDrift]);
  const identityStyle = useAnimatedStyle(() => ({ transform: [
    { translateY: withTiming(idle ? split ? 98 : compact ? 124 : 110 : 0, { duration: reduced ? 0 : 700, easing: Easing.out(Easing.cubic) }) },
    { translateY: stageDrift.value * 8 },
    { translateX: stageDrift.value * 12 },
  ] }));
  const controlsStyle = useAnimatedStyle(() => ({ opacity: withTiming(idle ? 0 : 1, { duration: reduced ? 0 : 500 }), transform: [{ translateY: withTiming(idle ? 10 : 0, { duration: reduced ? 0 : 500 }) }] }));
  const stageStyle = useAnimatedStyle(() => ({ transform: [{ translateX: stageDrift.value * 12 }, { translateY: stageDrift.value * 8 }] }));
  const art = track ? playerBackdropArtworkSource(track) : null;
  const artColors = useNowPlayingArtworkColors({ enabled: atmosphereReady && foreground && visualizer !== 'off' && !reduced, artworkUri: art, artworkIdentity: art, accent: { enabled: artworkAccent, method: 'adaptive', target: { isLight: !tv.dark, onAccent: tv.bg } }, isDark: tv.dark });
  const scopeColor = useMemo(() => {
    const { r, g, b } = hexToRgb(artColors.accent ?? tv.accent);
    const lab = rgbToOklab(r, g, b);
    return oklchToHex(tv.dark ? .8 : .45, Math.min(.16, Math.hypot(lab.a, lab.b)), Math.atan2(lab.b, lab.a) * 180 / Math.PI);
  }, [artColors.accent, tv.accent, tv.dark]);
  const spectrumStyle = useAnimatedStyle(() => ({ opacity: withTiming(idle ? split ? .4 : .75 : split ? .3 : .55, { duration: reduced ? 0 : 500 }) }));
  if (!track) return null;
  const controls: { id: PlayerControl; label: string; icon: keyof typeof Ionicons.glyphMap; action: () => Promise<void>; active?: boolean }[] = [
    { id: 'previous', label: 'Previous track', icon: 'play-skip-back', action: skipToPrevious },
    { id: 'next', label: 'Next track', icon: 'play-skip-forward', action: skipToNext },
    { id: 'shuffle', label: `Shuffle ${shuffle ? 'on' : 'off'}`, icon: 'shuffle', action: toggleShuffle, active: shuffle },
    { id: 'repeat', label: `Repeat ${repeat}`, icon: 'repeat', action: cycleRepeat, active: repeat !== 'none' },
  ];
  const pills: { id: PlayerControl; label: string; icon?: keyof typeof Ionicons.glyphMap; active?: boolean }[] = [
    { id: 'lyrics', label: 'Lyrics', active: split },
    { id: 'queue', label: 'Queue', icon: 'list-outline',  },
    { id: 'more', label: 'More', icon: 'ellipsis-horizontal',  },
  ];
  const artSize = split ? 200 : compact ? 52 : 220;
  return <Animated.View ref={setNode} collapsable={false} style={[StyleSheet.absoluteFill, { backgroundColor: tv.bg }, pageStyle]}>
    {/* Internal view/panel transitions run while this page is mounted; opening
        and closing animate the complete page together, without double fades. */}
    <LayoutAnimationConfig skipEntering skipExiting><View collapsable={false} style={StyleSheet.absoluteFill}>
    {atmosphereReady && <TvAtmosphere player fadeIn active={active && foreground && !reduced} playing={playing} uri={artworkAccent ? art : null} strength={view === 'cover' ? .9 : .58} />}
    {atmosphereReady && visualizer === 'spectrum' && !reduced && <Animated.View entering={tvLyricsEnter} exiting={tvExit} pointerEvents="none" style={box(0, 60, 960, 480)}><Animated.View style={spectrumStyle}>
      <SpectrumCurve active={playing && foreground && active} width={960} height={480} pointCount={120} smoothing={.92} frameMs={34} analysisFrameMs={34} color={scopeColor} lineWidth={1.6} lineOpacity={.55} fillOpacity={.10} />
    </Animated.View></Animated.View>}
    {atmosphereReady && compact && !reduced && <Animated.View entering={tvEnter} exiting={tvExit} layout={tvLayout} pointerEvents="none" style={[box(51, idle ? 90 : 80, 858, idle ? 260 : 180), stageStyle]}><OscilloscopeWave active={playing && foreground && !reduced} width={858} height={idle ? 260 : 180} frameMs={34} color={scopeColor} lineWidth={2.5} glow edgeFade edgeFadeWidth={60} /></Animated.View>}
    <TvFocusRegion enabled={!idle && !overlay}>
      {split && atmosphereReady && <Animated.View entering={tvLyricsEnter} exiting={tvLyricsExit} style={[StyleSheet.absoluteFill, stageStyle]}><TvPlayerLyrics key={track.path} path={track.path} foreground={foreground} reduced={reduced} interact={interact} /></Animated.View>}
    </TvFocusRegion>
    <Animated.View key={`${view}:${track.path}`} entering={split ? tvLyricsEnter : tvEnter} exiting={split ? tvLyricsExit : tvExit} pointerEvents="none" style={[box(51, split ? 52 : compact ? 316 : 156, split ? 330 : 858, split ? 274 : artSize), identityStyle]}>
      <TvArtwork uri={track.artworkData} size={artSize} style={{ borderRadius: compact ? 7 : 12 }} />
      <View style={split ? box(0, 218, 282) : { position: 'absolute', left: artSize + (compact ? 14 : 24), right: 64, bottom: compact ? 0 : 6 }}>
        <TvText size={split ? 26 : compact ? 20 : 46} weight="semibold" numberOfLines={split || compact ? 1 : 2} style={{ lineHeight: split ? 32 : compact ? 26 : 52, letterSpacing: split ? -.65 : compact ? -.4 : -1.8 }}>{track.title}</TvText>
        <TvText size={split ? 14 : compact ? 13.5 : 19} numberOfLines={1} style={{ marginTop: compact ? 2 : 6 }}>{track.artist}<TvText size={split ? 14 : compact ? 13.5 : 19} color={tv.muted}> · {track.album}</TvText></TvText>
      </View>
    </Animated.View>
    <TvFocusRegion enabled={!idle && !overlay}>
      <Animated.View style={[StyleSheet.absoluteFill, controlsStyle]}>
        {/* Play is also the first native focus candidate during mounting. */}
        <Animated.View layout={tvLyricsLayout} style={box(51, split ? 348 : 398, split ? 48 : 52, split ? 48 : 52)}><TvButton id="np:play" onLayout={() => {
          // The opening request may reach Android before this view has bounds.
          // Retry once after layout, never on later lyrics/visualizer resizes.
          if (!playLaidOut.current) { playLaidOut.current = true; if (active) request('np:play'); }
        }} onFocus={() => controlFocus('play')} onDirection={(d, p) => direction('play', d, p)} label={playing ? 'Pause' : 'Play'} onPress={() => { interact(); run(togglePlay); }} style={[{ width: '100%', height: '100%' }, { backgroundColor: tv.strong, borderRadius: 26, alignItems: 'center' }]} ringStyle={{ borderRadius: 30 }}><Ionicons name={playing ? 'pause' : 'play'} size={23} color={tv.bg} /></TvButton></Animated.View>
        <Animated.View layout={tvLyricsLayout} style={box(split ? 343 : 871, split ? 270 : compact ? 336 : 330, 38, 38)}><TvButton id="np:favorite" onFocus={() => controlFocus('favorite')} onDirection={(d, p) => direction('favorite', d, p)} label={favorite ? 'Remove from Favorites' : 'Add to Favorites'} onPress={() => { interact(); run(() => usePlaylistStore.getState().toggleFavorite(track)); }} style={[{ width: '100%', height: '100%' }, { borderRadius: 19, alignItems: 'center', backgroundColor: tv.hover }]} ringStyle={{ borderRadius: 23 }}><Ionicons name={favorite ? 'heart' : 'heart-outline'} size={18} color={favorite ? '#ff6f9a' : tv.text} /></TvButton></Animated.View>
        <Animated.View layout={tvLyricsLayout} style={box(split ? 111 : 123, split ? 360 : 410, split ? 270 : 786, split ? 24 : 28)}><TvButton id="np:seek" onFocus={() => controlFocus('seek')} onDirection={(d, p) => direction('seek', d, p)} label={effectivePreview === null ? 'Seek, press OK to adjust' : `Seek preview ${playerTime(effectivePreview)}, OK to apply, Back to cancel`} onPress={pressSeek} style={{ width: '100%', height: '100%' }} ringStyle={{ top: -8, bottom: -8, left: -8, right: -8, borderColor: effectivePreview !== null ? tv.accent : tv.focus }}>
          <TvPlayerWaveform path={track.path} width={split ? 270 : 786} height={split ? 24 : 28} preview={effectivePreview} active={foreground && !idle} />
        </TvButton></Animated.View>
        {controls.map((control, i) => <Animated.View key={control.id} layout={tvLyricsLayout} style={box(51 + i * 48, split ? 416 : 470, 38, 38)}><TvButton id={`np:${control.id}`} onFocus={() => controlFocus(control.id)} onDirection={(d, p) => direction(control.id, d, p)} label={control.label} onPress={() => { interact(); run(control.action); }} style={[{ width: '100%', height: '100%' }, { borderRadius: 19, alignItems: 'center', backgroundColor: control.active ? tv.fill : tv.hover }]} ringStyle={{ borderRadius: 23 }}>
          {control.id === 'shuffle'
            ? <ShuffleForkIcon on={shuffle} size={21} inactiveColor={tv.text} activeColor={tv.accent} />
            : control.id === 'repeat'
              ? <RepeatFlowIcon mode={repeat} size={21} inactiveColor={tv.text} activeColor={tv.accent} />
              : <Ionicons name={control.icon} size={17} color={tv.text} />}
        </TvButton></Animated.View>)}
        {pills.map((pill, i) => <Animated.View key={pill.id} layout={tvLyricsLayout} style={box((split ? 51 : 591) + i * 109, split ? 464 : 470, 100, 36)}><TvButton id={`np:${pill.id}`} onFocus={() => controlFocus(pill.id)} onDirection={(d, p) => direction(pill.id, d, p)} label={pill.label} onPress={() => { interact(); if (pill.id === 'lyrics') changeView(split ? playerViewWithVisualizer('cover', visualizer) : 'lyrics'); else if (pill.id === 'queue') setQueue(true); else more(); }} style={[{ width: '100%', height: '100%' }, { flexDirection: 'row', gap: 8, alignItems: 'center', borderRadius: 18, backgroundColor: pill.active ? tv.fill : tv.hover, borderWidth: 1, borderColor: pill.active ? tv.accent : tv.border }]} ringStyle={{ borderRadius: 22 }}>{pill.id === 'lyrics' ? <MaterialCommunityIcons name="comment-quote-outline" size={16} color={pill.active ? tv.accent : tv.text} /> : pill.icon && <Ionicons name={pill.icon} size={14} color={pill.active ? tv.accent : tv.text} />}<TvText size={13.5} weight="medium" color={pill.active ? tv.accent : tv.text}>{pill.label}</TvText></TvButton></Animated.View>)}
        {effectivePreview !== null && <TvText size={11.5} color={tv.accent} style={[box(split ? 437 : 320, split ? 480 : 515, split ? 472 : 590), { textAlign: 'right' }]}>← → Preview · Hold to seek faster · OK Apply · Back Cancel</TvText>}
      </Animated.View>
    </TvFocusRegion>
    {idle && <>
      <TvPlayerHairline path={track.path} active={foreground} />
      <TvButton id="np:idle" label="Now playing, OK to pause, arrows to show controls, Back to leave" onPress={() => { interact(); run(togglePlay); request('np:play'); }} onDirection={() => { interact(); request(lastControl.current); }} style={StyleSheet.absoluteFill} ringStyle={{ borderWidth: 0 }}><View /></TvButton>
    </>}
    {queue && <TvPlayerQueue close={closeQueue} run={run} />}
    {menu && <TvFocusRegion enabled={!signal && !customTimer}><TvPanel menu={menu} close={closeMenu} /></TvFocusRegion>}
    {signal && <SignalPanel track={signal} close={closeSignal} />}
    {customTimer && <Animated.View entering={tvEnter} exiting={tvExit} style={[StyleSheet.absoluteFill, { backgroundColor: tv.bg }]}><TvNameFlow labels={{ eyebrow: 'SLEEP TIMER', title: 'Sleep timer', description: 'Pause playback after 1–720 minutes.', field: 'Minutes', verb: 'Set timer' }} initial="30" keyboardType="numeric" cancel={() => { setCustomTimer(false); request('menu:7'); interact(); }} submit={async text => {
      const minutes = Number(text);
      if (!Number.isInteger(minutes) || minutes < 1 || minutes > 720) throw new Error('Enter a whole number from 1 to 720.');
      await useSleepTimerStore.getState().startMinutes(minutes); Keyboard.dismiss(); setCustomTimer(false); setMenus(previous => previous.slice(0, 1)); request('menu:1'); interact();
    }} /></Animated.View>}
    </View></LayoutAnimationConfig>
  </Animated.View>;
}

function SignalPanel({ track, close }: { track: Track; close: () => void }) {
  const tv = useTvTheme(); const { request } = useTvFocus();
  const result = useMemo(() => { try { return { layout: signalLayoutFromTrack(track), error: '' }; } catch (reason) { return { layout: null, error: reason instanceof Error ? reason.message : 'Signal could not be generated for this track.' }; } }, [track]);
  useEffect(() => { request('np:signal:done'); }, [request]);
  return <Animated.View collapsable={false} entering={tvEnter} exiting={tvExit} style={[StyleSheet.absoluteFill, { backgroundColor: tv.scrim }]}><Animated.View entering={tvPanelEnter} style={[box(240, 146, 480), { padding: 26, borderRadius: 14, backgroundColor: tv.panel, borderWidth: 1, borderColor: tv.border }]}>
    <TvText size={20} weight="semibold">Astra Signal</TvText>
    <View style={{ marginVertical: 20 }}>{result.layout ? <SignalCode layout={result.layout} width={426} foreground="#0a0d14" background="#f6f8fd" /> : <TvText>{result.error}</TvText>}</View>
    <TvText size={13} color={tv.muted} numberOfLines={3}>Scan with Astra on your phone to find “{track.title}”.</TvText>
    <TvButton id="np:signal:done" label="Done" onPress={close} style={{ marginTop: 20, height: 36, backgroundColor: tv.fill, alignItems: 'center' }}><TvText>Done</TvText></TvButton>
  </Animated.View></Animated.View>;
}

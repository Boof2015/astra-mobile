import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ScrollView, View, type LayoutChangeEvent } from 'react-native';
import Animated, { useAnimatedReaction, useAnimatedStyle, useSharedValue, withTiming, type SharedValue } from 'react-native-reanimated';
import { useSmoothPlaybackTime } from '@/audio/useSmoothPlaybackTime';
import { useAnimatedPlaybackProgress } from '@/audio/useAnimatedPlaybackProgress';
import { getLyricsEmptyStatePresentation, getSyncedLyricsDisplayLines, hasRenderableSyncedLines, LYRICS_DISPLAY_LEAD_MS, resolveSyncedLyricsTiming, type SyncedLyricsDisplayLine, type SyncedLyricsTimingState } from '@/lyrics/presentation';
import type { LyricsLine } from '@/lyrics/types';
import { useLyricsSettingsStore } from '@/stores/lyricsSettingsStore';
import { useLyricsStore } from '@/stores/lyricsStore';
import { usePlayerStore } from '@/stores/playerStore';
import { TvButton, useTvFocus } from './TvFocus';
import { box, TvText, TvViewport } from './TvPrimitives';
import { useTvTheme } from './useTvTheme';
import { TvLyricLine, type TvLyricsSettings } from './TvLyricLine';
import { lyricInWindow, lyricVoices } from './playerLyricsModel';

// Only this small clock component ticks on JS. The measured song column gets a
// React update at cue boundaries; karaoke sweeps run on the UI playback clock.
const LyricsClock = memo(function LyricsClock({ lines, path, duration, foreground, seconds, changed }: {
  lines: LyricsLine[]; path: string; duration: number; foreground: boolean; seconds: SharedValue<number>; changed: (timing: SyncedLyricsTimingState) => void;
}) {
  const time = usePlayerStore(s => s.currentTime);
  const playing = usePlayerStore(s => s.playbackState === 'playing');
  const progress = useAnimatedPlaybackProgress({ currentTime: time, duration, isPlaying: playing, active: foreground, trackKey: path });
  // Karaoke needs less bandwidth than the large line movement. Sample its UI
  // clock at 30 Hz; line scrolling/lifts keep their full-rate animations.
  useAnimatedReaction(() => {
    const time = progress.value * duration;
    return playing && foreground ? Math.floor(time * 30) / 30 : time;
  }, time => { seconds.set(time + LYRICS_DISPLAY_LEAD_MS / 1000); }, [duration, playing, foreground]);
  const smooth = useSmoothPlaybackTime(time, duration, playing && foreground) + LYRICS_DISPLAY_LEAD_MS / 1000;
  const timing = resolveSyncedLyricsTiming(lines, smooth, { durationSeconds: duration });
  const { activeCueIndex, activeLineIndex, focusLineIndex, isNeutral } = timing;
  useEffect(() => { changed({ activeCueIndex, activeLineIndex, focusLineIndex, isNeutral }); }, [activeCueIndex, activeLineIndex, focusLineIndex, isNeutral, changed]);
  return null;
});

function SyncedColumn({ display, timing, seconds, voices, settings, reduced }: {
  display: SyncedLyricsDisplayLine[]; timing: SyncedLyricsTimingState; seconds: SharedValue<number>;
  voices: ReturnType<typeof lyricVoices>; settings: TvLyricsSettings; reduced: boolean;
}) {
  const [layout, setLayout] = useState<{ display: typeof display; offsets: number[]; heights: number[]; revision: number }>({ display, offsets: [], heights: [], revision: 0 });
  const [measured, setMeasured] = useState<typeof display | null>(null);
  if (layout.display !== display) setLayout({ display, offsets: [], heights: [], revision: layout.revision + 1 });
  const measure = useCallback((index: number, event: LayoutChangeEvent) => {
    const { y, height } = event.nativeEvent.layout;
    setLayout(previous => {
      if (previous.display !== display || previous.offsets[index] === y && previous.heights[index] === height) return previous;
      const offsets = [...previous.offsets]; offsets[index] = y;
      const heights = [...previous.heights]; heights[index] = height;
      return { display, offsets, heights, revision: previous.revision + 1 };
    });
  }, [display]);
  useEffect(() => {
    if (measured === display || !display.every((_, i) => layout.heights[i] > 0)) return;
    // Let native word balancing finish before replacing offscreen lines with
    // exact spacers. Visible lines keep their identity throughout each shift.
    const timer = setTimeout(() => setMeasured(display), 160);
    return () => clearTimeout(timer);
  }, [display, layout, measured]);
  const focus = Math.max(0, timing.focusLineIndex);
  const offset = layout.offsets[focus];
  const columnStyle = useAnimatedStyle(() => ({ opacity: withTiming(offset === undefined ? 0 : 1, { duration: reduced ? 0 : 350 }) }));
  return <Animated.View pointerEvents="none" importantForAccessibility="no-hide-descendants" style={columnStyle}>
    {display.map(item => {
      const index = item.displayIndex;
      if (measured === display && offset !== undefined && !lyricInWindow(layout.offsets[index], layout.heights[index], offset)) {
        return <View key={item.key} style={{ height: layout.heights[index], marginBottom: 26 }} />;
      }
      const current = index === (timing.isNeutral ? focus : timing.activeLineIndex);
      const voice = item.kind === 'lyric' ? voices[item.cueIndex] : null;
      return <TvLyricLine key={item.key} item={item} distance={index - focus} current={current}
        clock={current ? seconds : undefined} shift={176 - (offset ?? 0)} revision={layout.revision} reduced={reduced}
        right={voice?.right ?? false} label={voice?.label ?? null} settings={settings} measure={measure} />;
    })}
  </Animated.View>;
}

export function TvPlayerLyrics({ path, foreground, reduced, interact }: { path: string; foreground: boolean; reduced: boolean; interact: () => void }) {
  const tv = useTvTheme();
  const { request, focused } = useTvFocus();
  const entry = useLyricsStore(s => s.byPath[path]);
  const { wordTimingEnabled, furiganaEnabled, translationsEnabled, translationPriority, voiceLabelsEnabled } = useLyricsSettingsStore();
  const settings = useMemo(() => ({ wordTimingEnabled, furiganaEnabled, translationsEnabled, translationPriority, voiceLabelsEnabled }), [wordTimingEnabled, furiganaEnabled, translationsEnabled, translationPriority, voiceLabelsEnabled]);
  const duration = usePlayerStore(s => s.duration);
  const seconds = useSharedValue(usePlayerStore.getState().currentTime + LYRICS_DISPLAY_LEAD_MS / 1000);
  const result = entry?.result;
  const lines = useMemo(() => result?.status === 'hit' ? result.lyrics.syncedLines : [], [result]);
  const display = useMemo(() => getSyncedLyricsDisplayLines(lines, { durationSeconds: duration }), [lines, duration]);
  const [timing, setTiming] = useState(() => resolveSyncedLyricsTiming(lines, usePlayerStore.getState().currentTime + LYRICS_DISPLAY_LEAD_MS / 1000, { durationSeconds: duration }));
  const plain = result?.status === 'hit' ? result.lyrics.plainLyrics : null;
  const scroller = useRef<ScrollView>(null);
  const scroll = useRef(0);
  const [contentHeight, setContentHeight] = useState(0);
  const hasSynced = hasRenderableSyncedLines(lines);
  const voices = useMemo(() => lyricVoices(lines), [lines]);
  return <View style={box(437, 0, 472, 540)}>
    {hasSynced && <LyricsClock lines={lines} path={path} duration={duration} foreground={foreground} seconds={seconds} changed={setTiming} />}
    <TvViewport width={472} height={540} topFade={96} bottomFade={96}>
      {hasSynced ? <SyncedColumn key={JSON.stringify([furiganaEnabled, translationsEnabled, translationPriority, voiceLabelsEnabled])}
        display={display} timing={timing} seconds={seconds} voices={voices} settings={settings} reduced={reduced} />
        : plain ? <ScrollView ref={scroller} scrollEnabled={false} focusable={false} showsVerticalScrollIndicator={false} onContentSizeChange={(_, h) => setContentHeight(h)} contentContainerStyle={{ paddingVertical: 90, paddingHorizontal: 8 }}><TvText size={24} style={{ lineHeight: 36 }}>{plain}</TvText></ScrollView>
        : <View style={{ flex: 1, justifyContent: 'center' }}><TvText size={20} color={tv.muted}>{entry?.loading || !entry ? 'Finding lyrics…' : result?.status === 'not_found' ? 'No lyrics for this track' : getLyricsEmptyStatePresentation({ result: result ?? null, isLoading: false }).message}</TvText></View>}
    </TvViewport>
    {!hasSynced && !!plain && <TvButton id="np:plain" label="Lyrics, Up and Down to scroll, Left to return to controls" onPress={interact}
      onDirection={direction => {
        interact();
        if (direction === 'left') request('np:seek');
        else if (direction === 'up' || direction === 'down') { scroll.current = Math.max(0, Math.min(Math.max(0, contentHeight - 540), scroll.current + (direction === 'up' ? -110 : 110))); scroller.current?.scrollTo({ y: scroll.current, animated: true }); }
      }} style={box(0, 64, 472, 412)}>
      <View />
    </TvButton>}
    {focused === 'np:plain' && <View pointerEvents="none" style={[box(80, 502, 312, 26), { borderRadius: 13, backgroundColor: tv.panel, alignItems: 'center', justifyContent: 'center' }]}><TvText size={11} color={tv.muted}>↑ ↓ Scroll lyrics · ← Controls</TvText></View>}
  </View>;
}

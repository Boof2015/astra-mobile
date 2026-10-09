import { useCallback, useMemo, useRef, useState } from 'react';
import { ScrollView, View, type LayoutChangeEvent } from 'react-native';
import Animated, { useAnimatedStyle, withTiming } from 'react-native-reanimated';
import { useSmoothPlaybackTime } from '@/audio/useSmoothPlaybackTime';
import { getLyricsEmptyStatePresentation, getSyncedLyricsDisplayLines, hasRenderableSyncedLines, LYRICS_DISPLAY_LEAD_MS, resolveSyncedLyricsTiming } from '@/lyrics/presentation';
import { useLyricsSettingsStore } from '@/stores/lyricsSettingsStore';
import { useLyricsStore } from '@/stores/lyricsStore';
import { usePlayerStore } from '@/stores/playerStore';
import { TvButton, useTvFocus } from './TvFocus';
import { box, TvText, TvViewport } from './TvPrimitives';
import { useTvTheme } from './useTvTheme';
import { TvLyricLine } from './TvLyricLine';
import { lyricVoices } from './playerLyricsModel';

export function TvPlayerLyrics({ path, foreground, reduced, interact }: { path: string; foreground: boolean; reduced: boolean; interact: () => void }) {
  const tv = useTvTheme();
  const { request, focused } = useTvFocus();
  const entry = useLyricsStore(s => s.byPath[path]);
  const { wordTimingEnabled, furiganaEnabled, translationsEnabled, translationPriority, voiceLabelsEnabled } = useLyricsSettingsStore();
  const settings = useMemo(() => ({ wordTimingEnabled, furiganaEnabled, translationsEnabled, translationPriority, voiceLabelsEnabled }), [wordTimingEnabled, furiganaEnabled, translationsEnabled, translationPriority, voiceLabelsEnabled]);
  const time = usePlayerStore(s => s.currentTime);
  const duration = usePlayerStore(s => s.duration);
  const playing = usePlayerStore(s => s.playbackState === 'playing');
  const smooth = useSmoothPlaybackTime(time, duration, playing && foreground) + LYRICS_DISPLAY_LEAD_MS / 1000;
  const result = entry?.result;
  const lines = useMemo(() => result?.status === 'hit' ? result.lyrics.syncedLines : [], [result]);
  const display = useMemo(() => getSyncedLyricsDisplayLines(lines, { durationSeconds: duration }), [lines, duration]);
  const timing = resolveSyncedLyricsTiming(lines, smooth, { durationSeconds: duration });
  const plain = result?.status === 'hit' ? result.lyrics.plainLyrics : null;
  const scroller = useRef<ScrollView>(null);
  const scroll = useRef(0);
  const [contentHeight, setContentHeight] = useState(0);
  const hasSynced = hasRenderableSyncedLines(lines);
  const voices = useMemo(() => lyricVoices(lines), [lines]);
  const [layout, setLayout] = useState<{ offsets: number[]; revision: number }>({ offsets: [], revision: 0 });
  const measure = useCallback((index: number, event: LayoutChangeEvent) => {
    const y = event.nativeEvent.layout.y;
    setLayout(previous => {
      if (previous.offsets[index] === y) return previous;
      const offsets = [...previous.offsets]; offsets[index] = y;
      return { offsets, revision: previous.revision + 1 };
    });
  }, []);
  const focus = Math.max(0, timing.focusLineIndex);
  const offset = layout.offsets[focus];
  // Measuring a full XLRC column can outlast the page entrance. Reveal only
  // once its anchor is known, on a separate clock from that entrance.
  const columnStyle = useAnimatedStyle(() => ({ opacity: withTiming(offset === undefined ? 0 : 1, { duration: reduced ? 0 : 350 }) }));
  return <View style={box(437, 0, 472, 540)}>
    <TvViewport width={472} height={540} topFade={96} bottomFade={96}>
      {hasSynced ? <Animated.View pointerEvents="none" importantForAccessibility="no-hide-descendants" style={columnStyle}>
        {display.map(item => {
          const current = item.displayIndex === (timing.isNeutral ? focus : timing.activeLineIndex);
          const voice = item.kind === 'lyric' ? voices[item.cueIndex] : null;
          return <TvLyricLine key={item.key} item={item} distance={item.displayIndex - focus} current={current}
            time={current ? smooth : null} shift={176 - (offset ?? 0)} revision={layout.revision} reduced={reduced}
            right={voice?.right ?? false} label={voice?.label ?? null} settings={settings} measure={measure} />;
        })}
      </Animated.View> : plain ? <ScrollView ref={scroller} scrollEnabled={false} focusable={false} showsVerticalScrollIndicator={false} onContentSizeChange={(_, h) => setContentHeight(h)} contentContainerStyle={{ paddingVertical: 90, paddingHorizontal: 8 }}><TvText size={24} style={{ lineHeight: 36 }}>{plain}</TvText></ScrollView>
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

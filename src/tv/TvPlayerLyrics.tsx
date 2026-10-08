import { useMemo, useRef, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { useSmoothPlaybackTime } from '@/audio/useSmoothPlaybackTime';
import { RubyText, TimedWord } from '@/components/lyrics/LyricsLine';
import { getLyricsEmptyStatePresentation, getPreferredLyricsTranslation, getSyncedLyricsDisplayLines, hasRenderableSyncedLines, LYRICS_DISPLAY_LEAD_MS, resolveLyricsWordTiming, resolveSyncedLyricsTiming } from '@/lyrics/presentation';
import { useLyricsSettingsStore } from '@/stores/lyricsSettingsStore';
import { useLyricsStore } from '@/stores/lyricsStore';
import { usePlayerStore } from '@/stores/playerStore';
import { TvButton, useTvFocus } from './TvFocus';
import { box, TvText, TvViewport } from './TvPrimitives';
import { useTvTheme } from './useTvTheme';
import Animated from 'react-native-reanimated';
import { tvEnter, tvLayout } from './TvTransitions';

export function TvPlayerLyrics({ path, foreground, interact }: { path: string; foreground: boolean; interact: () => void }) {
  const tv = useTvTheme();
  const { request, focused } = useTvFocus();
  const entry = useLyricsStore(s => s.byPath[path]);
  const settings = useLyricsSettingsStore();
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
  return <View style={box(437, 0, 472, 540)}>
    <TvViewport width={472} height={540} topFade={70} bottomFade={70}>
      {hasSynced ? <View pointerEvents="none" importantForAccessibility="no-hide-descendants" style={{ flex: 1, justifyContent: 'center' }}>
        {display.slice(Math.max(0, timing.focusLineIndex - 2), timing.focusLineIndex + 5).map(item => {
          const distance = item.displayIndex - timing.focusLineIndex;
          const current = !timing.isNeutral && item.displayIndex === timing.activeLineIndex;
          if (item.kind === 'gap') return <Animated.View key={item.key} layout={tvLayout} style={{ width: 90, height: 3, marginVertical: 24, borderRadius: 2, opacity: distance === 0 ? .8 : .16, backgroundColor: tv.muted }} />;
          const line = item.line;
          const size = current ? 40 : 24;
          const words = settings.wordTimingEnabled ? line.words ?? [] : [];
          const wordTiming = current ? resolveLyricsWordTiming(words, smooth) : null;
          const translation = current && settings.translationsEnabled ? getPreferredLyricsTranslation(line, settings.translationPriority) : null;
          const ruby = { size, lineHeight: Math.round(size * 1.35), readingSize: size * .38, readingHeight: Math.round(size * .5) };
          return <Animated.View key={item.key} entering={tvEnter} layout={tvLayout} style={{ marginBottom: current ? 22 : 18 }}><View style={{ opacity: current ? 1 : distance === 1 ? .55 : Math.abs(distance) >= 2 ? .16 : .28 }}>
            {current && settings.voiceLabelsEnabled && !!line.voice && <TvText size={11} color={tv.accent}>{line.voice}</TvText>}
            {words.length ? <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'flex-start' }}>{words.map((word, i) => <TimedWord key={i} word={word} progress={wordTiming?.progressByIndex[i] ?? 0} furiganaEnabled={settings.furiganaEnabled} {...ruby} />)}</View>
              : <RubyText text={line.text} furigana={line.furigana} enabled={settings.furiganaEnabled} color={tv.strong} readingColor={tv.muted} {...ruby} />}
            {translation && <TvText size={18} color={tv.muted} style={{ marginTop: 6 }}>{translation.text}</TvText>}
          </View></Animated.View>;
        })}
      </View> : plain ? <ScrollView ref={scroller} scrollEnabled={false} focusable={false} showsVerticalScrollIndicator={false} onContentSizeChange={(_, h) => setContentHeight(h)} contentContainerStyle={{ paddingVertical: 90, paddingHorizontal: 8 }}><TvText size={24} style={{ lineHeight: 36 }}>{plain}</TvText></ScrollView>
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

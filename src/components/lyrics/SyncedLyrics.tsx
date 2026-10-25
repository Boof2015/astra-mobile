import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AccessibilityInfo, View, type LayoutChangeEvent } from 'react-native';
import Animated, { useReducedMotion, useSharedValue, type SharedValue } from 'react-native-reanimated';
import { ActionButton } from '@/components/ActionButton';
import { AppPressableGestureScope, SCROLL_PRESS_DELAY } from '@/components/AppPressable';
import { GradientMask } from '@/components/GradientMask';
import { lyricOpacity, lyricVoices } from '@/lyrics/animation';
import type { LyricsDisplaySettings } from '@/lyrics/displaySettings';
import { getLyricsLineSeekTimeSeconds, getSyncedLyricsDisplayLines, LYRICS_DISPLAY_LEAD_MS, resolveSyncedLyricsTiming, type SyncedLyricsDisplayLine, type SyncedLyricsTimingState } from '@/lyrics/presentation';
import type { LyricsLine as Line } from '@/lyrics/types';
import { LyricsPlaybackClock } from './LyricsPlaybackClock';
import { LyricsRowMotion } from './LyricsRowMotion';
import { LyricsLine } from './LyricsLine';
import { LyricsGap } from './LyricsGap';
import { lyricsAnchorOffset, lyricsRowInWindow } from './lyricsFollowState';
import { useLyricsFollow, type LyricsScrollMotion } from './useLyricsFollow';

interface ColumnProps {
  lines: Line[];
  duration: number;
  active: boolean;
  width: number;
  height: number;
  size: number;
  padding: number;
  settings: LyricsDisplaySettings;
  onSeek: (seconds: number) => void;
}

// Stable event closures let the text subtree remain memoized when a neighboring
// cue moves or another row reports a measurement.
const Row = memo(function Row({ item, motion, opacity, current, past, warm, nearby, browsing, reduced, right, label, clock, size, width, settings, duration, measure, onSeek }: {
  item: SyncedLyricsDisplayLine; motion: LyricsScrollMotion; opacity: number; current: boolean; past: boolean; warm: boolean; nearby: boolean;
  browsing: boolean; reduced: boolean; right: boolean; label: string | null; clock?: SharedValue<number>;
  size: number; width: number; settings: LyricsDisplaySettings; duration: number;
  measure: (index: number, event: LayoutChangeEvent) => void; onSeek: (seconds: number) => void;
}) {
  const onLayout = useCallback((event: LayoutChangeEvent) => measure(item.displayIndex, event), [item.displayIndex, measure]);
  const seek = useCallback(() => {
    const seconds = getLyricsLineSeekTimeSeconds(item.timestampMs, duration, 0);
    if (seconds !== null) onSeek(seconds);
  }, [item.timestampMs, duration, onSeek]);
  return <LyricsRowMotion index={item.displayIndex} motion={motion} opacity={opacity} current={current} gap={item.kind === 'gap'} nearby={nearby}
    browsing={browsing} reduced={reduced} right={right} spacing={size * 20 / 30} onLayout={onLayout}>
    {item.kind === 'gap'
      ? <LyricsGap clock={clock} start={item.progressStartMs} end={item.progressEndMs} past={past} width={Math.min(220, Math.max(110, width * .3))} />
      : <LyricsLine line={item.line} endMs={item.endMs} size={size} width={width} right={right} label={label} clock={clock}
        warm={warm} reduced={reduced} settings={settings} onSeek={seek} />}
  </LyricsRowMotion>;
});

const Column = memo(function Column({ lines, duration, active, width, height, size, padding, settings, onSeek, seconds, timing }: ColumnProps & {
  seconds: SharedValue<number>; timing: SyncedLyricsTimingState;
}) {
  const initialReduced = useReducedMotion();
  const [reduced, setReduced] = useState(initialReduced);
  useEffect(() => {
    let alive = true;
    void AccessibilityInfo.isReduceMotionEnabled().then(value => { if (alive) setReduced(value); });
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduced);
    return () => { alive = false; subscription.remove(); };
  }, []);
  const display = useMemo(() => getSyncedLyricsDisplayLines(lines, { durationSeconds: duration }), [lines, duration]);
  const voices = useMemo(() => lyricVoices(lines), [lines]);
  const geometry = useRef<{ offsets: number[]; heights: number[]; content: number }>({ offsets: [], heights: [], content: 0 });
  const [layout, setLayout] = useState({ offsets: [] as number[], heights: [] as number[], content: 0, revision: 0 });
  const frame = useRef<number | null>(null);
  const [windowOffset, setWindowOffset] = useState(0);
  const changed = useCallback(() => {
    if (frame.current !== null) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = null;
      const { offsets, heights, content } = geometry.current;
      setLayout(previous => ({ offsets: [...offsets], heights: [...heights], content, revision: previous.revision + 1 }));
    });
  }, []);
  useEffect(() => () => { if (frame.current !== null) cancelAnimationFrame(frame.current); }, []);
  const measure = useCallback((index: number, event: LayoutChangeEvent) => {
    const { y, height: rowHeight } = event.nativeEvent.layout;
    if (geometry.current.offsets[index] === y && geometry.current.heights[index] === rowHeight) return;
    geometry.current.offsets[index] = y;
    geometry.current.heights[index] = rowHeight;
    changed();
  }, [changed]);
  const contentChanged = useCallback((_: number, content: number) => {
    if (geometry.current.content === content) return;
    geometry.current.content = content;
    changed();
  }, [changed]);
  const focus = Math.max(0, timing.focusLineIndex);
  const target = lyricsAnchorOffset(layout.offsets[focus], layout.heights[focus], height, layout.content);
  const { ref, motion, onScroll, browsing, recenter } = useLyricsFollow({
    focus, current: timing.activeLineIndex, target, layoutRevision: layout.revision, active, reduced, viewport: height, windowChanged: setWindowOffset,
  });
  const fade = Math.min(96, height * 96 / 540) / height;
  return <AppPressableGestureScope>
    <GradientMask width={width} height={height} stops={[0, fade, 1 - fade, 1]}>
      <Animated.ScrollView ref={ref} onScroll={onScroll} scrollEventThrottle={16} onContentSizeChange={contentChanged}
        removeClippedSubviews={false} showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingVertical: height * .4, paddingHorizontal: padding }}>
        {display.map(item => {
          const index = item.displayIndex;
          const distance = index - focus;
          const current = timing.isNeutral ? item.kind === 'gap' && index === focus : index === timing.activeLineIndex;
          const voice = item.kind === 'lyric' ? voices[item.cueIndex] : null;
          // Include the destination before a follow begins, while retaining the
          // current window until the native scroll has reached it.
          const nearby = active && (lyricsRowInWindow(layout.offsets[index], layout.heights[index], windowOffset, height)
            || !browsing && target !== null && lyricsRowInWindow(layout.offsets[index], layout.heights[index], target, height));
          const timed = item.kind === 'gap' || settings.wordTimingEnabled && !!item.line.words?.length;
          // Keep row props stable across cue advances. A numeric distance used
          // to rerender every row, even far outside the animation window.
          return <Row key={item.key} item={item} motion={motion} opacity={lyricOpacity(distance, current)} current={current} nearby={nearby}
            past={item.kind === 'gap' && distance < 0} warm={timed && nearby && distance >= -1 && distance <= 2}
            browsing={browsing} reduced={reduced || !active} right={voice?.right ?? false} label={voice?.label ?? null}
            clock={timed && current ? seconds : undefined} size={size} width={width - padding * 2} settings={settings}
            duration={duration} measure={measure} onSeek={onSeek} />;
        })}
      </Animated.ScrollView>
    </GradientMask>
    {browsing && <ActionButton unstable_pressDelay={SCROLL_PRESS_DELAY} onPress={recenter} disabled={target === null}
      accessibilityLabel="Recenter lyrics on the current line" hitSlop={10} variant="primary" label="Recenter"
      style={{ position: 'absolute', bottom: 8, alignSelf: 'center' }} />}
  </AppPressableGestureScope>;
});

/** Key this surface by track, dimensions and settings. A refreshed payload also
 * resets the native measurements and clock, even when the path stays the same. */
export function SyncedLyrics(props: ColumnProps & { path: string; currentTime: number; isPlaying: boolean }) {
  const { lines, path, currentTime, duration, isPlaying, active } = props;
  const seconds = useSharedValue(currentTime + LYRICS_DISPLAY_LEAD_MS / 1000);
  const [source, setSource] = useState({ lines, duration, generation: 0 });
  const [timing, setTiming] = useState(() => resolveSyncedLyricsTiming(lines, currentTime + LYRICS_DISPLAY_LEAD_MS / 1000, { durationSeconds: duration }));
  if (source.lines !== lines || source.duration !== duration) {
    setSource({ lines, duration, generation: source.generation + 1 });
    setTiming(resolveSyncedLyricsTiming(lines, currentTime + LYRICS_DISPLAY_LEAD_MS / 1000, { durationSeconds: duration }));
  }
  return <View style={{ flex: 1 }}>
    <LyricsPlaybackClock key={source.generation} lines={lines} path={path} currentTime={currentTime} duration={duration}
      isPlaying={isPlaying} active={active} seconds={seconds} changed={setTiming} />
    <Column key={source.generation} lines={lines} duration={duration} active={active} width={props.width} height={props.height}
      size={props.size} padding={props.padding} settings={props.settings} onSeek={props.onSeek} seconds={seconds} timing={timing} />
  </View>;
}

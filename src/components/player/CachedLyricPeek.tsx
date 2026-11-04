import { useCallback, useEffect, useLayoutEffect, useMemo, useState } from 'react';
import { AccessibilityInfo, StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import Animated, {
  Easing,
  ReduceMotion,
  cancelAnimation,
  runOnJS,
  useAnimatedReaction,
  useAnimatedStyle,
  useDerivedValue,
  useReducedMotion,
  useSharedValue,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import { Text } from '@/components/Text';
import { GradientMask } from '@/components/GradientMask';
import { TactilePressable } from '@/components/player/TactilePressable';
import { useAnimatedPlaybackProgress } from '@/audio/useAnimatedPlaybackProgress';
import { lyricUnitText, lyricWordEndMs, lyricWordProgress } from '@/lyrics/animation';
import { peekCachedLyricsForTrack } from '@/lyrics/lyrics';
import {
  getSyncedLyricsDisplayLines,
  LYRICS_DISPLAY_LEAD_MS,
} from '@/lyrics/presentation';
import { fonts } from '@/theme';
import { NOW_PLAYING_LYRIC_LINE_HEIGHT } from '@/components/player/nowPlayingLayout';
import { createThemedStyles } from '@/theme/themed';
import { useLyricsSettingsStore } from '@/stores/lyricsSettingsStore';
import { useLyricsStore } from '@/stores/lyricsStore';
import { usePlayerStore } from '@/stores/playerStore';
import type { LyricsLine, LyricsLookupResult } from '@/lyrics/types';
import type { Track } from '@/types/audio';
import {
  currentLyricPeekLine,
  initialLyricPeekTransition,
  PEEK_ENTER_MS,
  PEEK_EXIT_MS,
  PEEK_SLIDE_PX,
  releaseLyricPeekSlot,
  requestLyricPeek,
  scheduleLyricPeekCompletion,
  watchLyricPeekLine,
  type LyricPeekCue,
  type LyricPeekSelection,
  type LyricPeekSource,
  type LyricPeekTransition,
} from './lyricPeekState';

/**
 * The synced line at the current playback position, re-rendering only when it
 * changes. Reads the position from the store directly rather than through a
 * selector, so the 2Hz progress mirror does not re-render the peek either.
 */
function useActiveLyricLine(
  source: LyricPeekSource,
  isPlaying: boolean
): LyricsLine | null {
  const [selection, setSelection] = useState<LyricPeekSelection | null>(null);
  useLayoutEffect(() => watchLyricPeekLine({
    source,
    isPlaying,
    readPlayback: () => {
      const state = usePlayerStore.getState();
      return { path: state.currentTrack?.path ?? null, currentTime: state.currentTime };
    },
    subscribe: (update) => usePlayerStore.subscribe((state, previous) => {
      if (state.currentTime !== previous.currentTime || state.currentTrack?.path !== previous.currentTrack?.path) update();
    }),
    changed: (next) => setSelection((previous) =>
      previous?.source === next.source && previous.line === next.line ? previous : next
    ),
  }), [source, isPlaying]);
  // Effects have not run yet on a source change. Never label the old selection
  // with the new track, even for that first render.
  return currentLyricPeekLine(source, selection);
}

/** Matches what the deck reserves when a caller doesn't pass a height. */
const DEFAULT_ROW_HEIGHT = NOW_PLAYING_LYRIC_LINE_HEIGHT + 4;

/** Soft edge of the sweep, the lyrics view's 16/30 of the font size at 16. */
const SWEEP_FEATHER = 9;

/**
 * The word sweep's UI clock, on the same lead as the line choice. Only this
 * null-rendering child follows the 2Hz progress mirror, so the peek itself
 * still renders once per line.
 */
function PeekWordClock({
  path,
  active,
  seconds,
}: {
  path: string;
  active: boolean;
  seconds: SharedValue<number>;
}) {
  const currentTime = usePlayerStore((s) => s.currentTime);
  const duration = usePlayerStore((s) => s.duration);
  const isPlaying = usePlayerStore(
    (s) => active && s.playbackState === 'playing'
  );
  const progress = useAnimatedPlaybackProgress({
    currentTime,
    duration,
    isPlaying,
    active,
    trackKey: path,
  });
  useAnimatedReaction(
    () => {
      const time = duration > 0 ? progress.value * duration : currentTime;
      return isPlaying ? Math.floor(time * 30) / 30 : time;
    },
    (time) => {
      seconds.set(time + LYRICS_DISPLAY_LEAD_MS / 1000);
    },
    [duration, currentTime, isPlaying]
  );
  return null;
}

/** The sung part of one word: the lyrics view's feathered sweep, in the primary color. */
function PeekWordLight({
  text,
  width,
  height,
  progress,
}: {
  text: string;
  width: number;
  height: number;
  progress: SharedValue<number>;
}) {
  const styles = useStyles();
  const sweep = useAnimatedStyle(() => ({
    transform: [
      { translateX: -width - SWEEP_FEATHER + progress.value * (width + SWEEP_FEATHER) },
    ],
  }));
  const glyph = useAnimatedStyle(() => ({
    transform: [
      { translateX: width + SWEEP_FEATHER - progress.value * (width + SWEEP_FEATHER) },
    ],
  }));
  return (
    <Animated.View
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[StyleSheet.absoluteFill, sweep]}
    >
      <GradientMask
        width={width + SWEEP_FEATHER}
        height={height}
        horizontal
        stops={[0, 0, width / (width + SWEEP_FEATHER), 1]}
      >
        <Animated.View style={[{ width }, glyph]}>
          <Text numberOfLines={1} style={[styles.line, styles.sung]}>
            {text}
          </Text>
        </Animated.View>
      </GradientMask>
    </Animated.View>
  );
}

function PeekWord({
  text,
  start,
  end,
  seconds,
  onHeight,
}: {
  text: string;
  start: number;
  end: number | undefined;
  seconds: SharedValue<number>;
  onHeight?: (height: number) => void;
}) {
  const styles = useStyles();
  const [layout, setLayout] = useState({ width: 0, height: 0 });
  const progress = useDerivedValue(() => lyricWordProgress(start, end, seconds.value));
  const onLayout = (event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    setLayout((previous) =>
      previous.width === width && previous.height === height ? previous : { width, height }
    );
    onHeight?.(height);
  };
  return (
    <View onLayout={onLayout}>
      <Text numberOfLines={1} style={styles.line}>
        {text}
      </Text>
      {layout.width > 0 ? (
        <PeekWordLight
          text={text}
          width={layout.width}
          height={layout.height}
          progress={progress}
        />
      ) : null}
    </View>
  );
}

/**
 * A word-timed line as wrapping word units, each sweeping from the peek's
 * secondary color to primary as it's sung. Units can't ellipsize, so a line
 * that needs more rows than the peek may show reports `onOverflow` and the
 * caller falls back to the plain, ellipsized line. Rows are measured, never
 * estimated.
 */
function PeekWords({
  line,
  endMs,
  lines,
  seconds,
  onOverflow,
}: {
  line: LyricsLine;
  endMs: number | null;
  lines: 1 | 2;
  seconds: SharedValue<number>;
  onOverflow: () => void;
}) {
  const styles = useStyles();
  const words = line.words ?? [];
  const [measured, setMeasured] = useState({ row: 0, word: 0 });
  useEffect(() => {
    if (measured.row > 0 && measured.word > 0 && measured.row > measured.word * lines + 0.5) {
      onOverflow();
    }
  }, [lines, measured, onOverflow]);
  return (
    <View
      style={styles.words}
      onLayout={(event) => {
        const row = event.nativeEvent.layout.height;
        setMeasured((previous) => (previous.row === row ? previous : { ...previous, row }));
      }}
    >
      {words.map((word, index) => (
        <PeekWord
          key={index}
          text={lyricUnitText(word.text)}
          start={word.timestampMs}
          end={lyricWordEndMs(words, index, endMs)}
          seconds={seconds}
          onHeight={
            index === 0
              ? (wordHeight) =>
                  setMeasured((previous) =>
                    previous.word === wordHeight ? previous : { ...previous, word: wordHeight }
                  )
              : undefined
          }
        />
      ))}
    </View>
  );
}

/** Measurements belong to the slot's cue, including while it is exiting. */
function PeekLine({ cue, lines, sweepEnabled, seconds }: {
  cue: LyricPeekCue;
  lines: 1 | 2;
  sweepEnabled: boolean;
  seconds: SharedValue<number>;
}) {
  const styles = useStyles();
  const [overflowedLines, setOverflowedLines] = useState<1 | 2 | null>(null);
  return sweepEnabled && cue.line.words?.length && overflowedLines !== lines ? (
    <PeekWords line={cue.line} endMs={cue.endMs} lines={lines} seconds={seconds}
      onOverflow={() => setOverflowedLines(lines)} />
  ) : (
    <Text numberOfLines={lines} ellipsizeMode="tail" style={styles.line}>
      {cue.line.text.trim()}
    </Text>
  );
}

/** Stable native frame: React owns removal; no exiting layout animation can
 * reparent this text above the player or retain it after its parent is gone. */
function PeekSlot({ entry, index, front, generation, animate, release, lines, sweepEnabled, seconds }: {
  entry: LyricPeekTransition['slots'][number];
  index: number;
  front: number;
  generation: number;
  animate: boolean;
  release: (index: number, generation: number) => void;
  lines: 1 | 2;
  sweepEnabled: boolean;
  seconds: SharedValue<number>;
}) {
  const styles = useStyles();
  const opacity = useSharedValue(0);
  const y = useSharedValue(0);
  const id = entry?.id;
  const outgoing = index !== front;
  useLayoutEffect(() => {
    cancelAnimation(opacity);
    cancelAnimation(y);
    const target = id === undefined || outgoing ? 0 : 1;
    if (id === undefined || !animate) {
      opacity.set(target);
      y.set(0);
      return undefined;
    }

    const duration = outgoing ? PEEK_EXIT_MS : PEEK_ENTER_MS;
    const targetY = outgoing ? -PEEK_SLIDE_PX : 0;
    if (!outgoing) {
      opacity.set(0);
      y.set(PEEK_SLIDE_PX);
    }
    const config = { duration, easing: Easing.linear, reduceMotion: ReduceMotion.System };
    const completion = scheduleLyricPeekCompletion(duration, () => {
      if (outgoing) release(index, generation);
    }, () => {
      cancelAnimation(opacity);
      cancelAnimation(y);
      opacity.set(target);
      y.set(targetY);
    });
    const complete = completion.finish;
    opacity.set(withTiming(target, config, (finished) => {
      if (finished) runOnJS(complete)();
    }));
    y.set(withTiming(targetY, config));
    return () => {
      completion.cancel();
      cancelAnimation(opacity);
      cancelAnimation(y);
    };
  }, [animate, generation, id, index, opacity, outgoing, release, y]);
  const style = useAnimatedStyle(() => ({ opacity: opacity.value, transform: [{ translateY: y.value }] }));
  return (
    <Animated.View pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants"
      style={[styles.lineFrame, style]}>
      {entry ? <PeekLine key={entry.id} cue={entry.cue} lines={lines} sweepEnabled={sweepEnabled} seconds={seconds} /> : null}
    </Animated.View>
  );
}

interface CachedLyricPeekProps {
  track: Track;
  active: boolean;
  hidden?: boolean;
  /** Row height the caller reserved for this slot (one line). */
  height?: number;
  /**
   * Lines a long lyric may wrap to. The row only ever reserves one; a second
   * line draws upward into empty space the caller has checked is free
   * (`getLyricPeekLines`), so wrapping can never move the title below it.
   */
  lines?: 1 | 2;
  onOpenLyrics: () => void;
}

/**
 * Synced lyric peek above the title. Online lookup opt-in uses the shared
 * lyrics resolver; otherwise the passive preview remains a cache-only SQLite read.
 */
export function CachedLyricPeek({
  track,
  active,
  hidden = false,
  height = DEFAULT_ROW_HEIGHT,
  lines = 1,
  onOpenLyrics,
}: CachedLyricPeekProps) {
  const styles = useStyles();
  const memoryResult = useLyricsStore((s) => s.byPath[track.path]?.result ?? null);
  const loadForTrack = useLyricsStore((s) => s.loadForTrack);
  const onlineLookupEnabled = useLyricsSettingsStore((s) => s.onlineLookupEnabled);
  const wordTimingEnabled = useLyricsSettingsStore((s) => s.wordTimingEnabled);
  const lyricsSettingsLoaded = useLyricsSettingsStore((s) => s.loaded);
  const [cached, setCached] = useState<{
    path: string;
    result: LyricsLookupResult | null;
  } | null>(null);
  const duration = usePlayerStore((s) => s.duration);
  const isPlaying = usePlayerStore(
    (s) => active && s.playbackState === 'playing'
  );

  useEffect(() => {
    if (!active || memoryResult) return;

    if (lyricsSettingsLoaded && onlineLookupEnabled) {
      void loadForTrack(track);
      return;
    }

    let cancelled = false;
    void peekCachedLyricsForTrack(track)
      .then((result) => {
        if (!cancelled) setCached({ path: track.path, result });
      })
      .catch(() => {
        if (!cancelled) setCached({ path: track.path, result: null });
      });
    return () => {
      cancelled = true;
    };
  }, [
    active,
    loadForTrack,
    lyricsSettingsLoaded,
    memoryResult,
    onlineLookupEnabled,
    track,
  ]);

  const storedResult = cached?.path === track.path ? cached.result : null;
  const result = memoryResult?.status === 'hit' ? memoryResult : storedResult;
  const syncedLines =
    active && !hidden && result?.status === 'hit' ? result.lyrics.syncedLines : null;
  const source = useMemo(() => ({ path: track.path, lines: syncedLines, duration }), [track.path, syncedLines, duration]);
  const activeLine = useActiveLyricLine(source, isPlaying);
  const text = activeLine?.text.trim() || null;

  const wordTimed = useMemo(
    () => !!syncedLines?.some((line) => line.words?.length),
    [syncedLines]
  );
  const sweepEnabled = wordTimingEnabled && wordTimed;
  const display = useMemo(
    () =>
      sweepEnabled && syncedLines
        ? getSyncedLyricsDisplayLines(syncedLines, { durationSeconds: duration })
        : null,
    [duration, sweepEnabled, syncedLines]
  );
  const activeRow = display?.find(
    (row) => row.kind === 'lyric' && row.line === activeLine
  );
  const endMs = activeRow?.kind === 'lyric' ? activeRow.endMs : null;
  const seconds = useSharedValue(0);
  const initialReducedMotion = useReducedMotion();
  const [reducedMotion, setReducedMotion] = useState(initialReducedMotion);
  useEffect(() => {
    let live = true;
    void AccessibilityInfo.isReduceMotionEnabled().then((value) => { if (live) setReducedMotion(value); });
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', setReducedMotion);
    return () => { live = false; subscription.remove(); };
  }, []);
  const cue = useMemo(() => text && activeLine ? { line: activeLine, endMs } : null, [text, activeLine, endMs]);
  const [transition, setTransition] = useState(() => initialLyricPeekTransition(source));
  // Reconcile before commit, so a changed/hidden source cannot render either
  // old slot while waiting for a passive effect to clear it.
  const requested = requestLyricPeek(transition, source, cue, !reducedMotion);
  if (requested !== transition) setTransition(requested);
  const release = useCallback((index: number, generation: number) => {
    setTransition((current) => releaseLyricPeekSlot(current, index, generation));
  }, []);

  return (
    <View style={[styles.wrap, lines > 1 && styles.overflowing, { height }]}>
      {sweepEnabled && active && !hidden ? (
        <PeekWordClock path={track.path} active={active} seconds={seconds} />
      ) : null}
      <TactilePressable
        style={[styles.pressable, lines > 1 && styles.overflowing]}
        disabled={!text}
        haptic="selection"
        onPress={onOpenLyrics}
        accessibilityRole={text ? 'button' : undefined}
        accessibilityLabel={text ? `Open lyrics: ${text}` : undefined}
      >
        {transition.slots.map((entry, index) => (
          <PeekSlot key={index} entry={entry} index={index} front={transition.front}
            generation={transition.generation} animate={transition.animate} release={release}
            lines={lines} sweepEnabled={sweepEnabled} seconds={seconds} />
        ))}
      </TactilePressable>
    </View>
  );
}

const useStyles = createThemedStyles((colors) => ({
  wrap: {
    // Height comes from the caller: the now-playing deck reserves this row so
    // its own total stays exact. This used to be 48px with a -12px top margin
    // to hide its footprint from the surrounding flow — the deck accounts for
    // the row properly now, so the row occupies the space it actually takes.
    overflow: 'hidden',
  },
  pressable: {
    flex: 1,
    overflow: 'hidden',
  },
  // A wrapped lyric draws its first line above the row, so neither box may clip.
  overflowing: {
    overflow: 'visible',
  },
  // Bottom-anchored: a single line always sits right above the title, and a
  // wrapped one grows upward, away from it.
  lineFrame: {
    position: 'absolute',
    bottom: 2,
    left: 0,
    right: 0,
    justifyContent: 'flex-end',
  },
  line: {
    color: colors.textSecondary,
    fontFamily: fonts.sans.medium,
    fontSize: 16,
    // Must stay in step with the deck's reservation for this row.
    lineHeight: NOW_PLAYING_LYRIC_LINE_HEIGHT,
  },
  sung: {
    color: colors.textPrimary,
  },
  words: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
}));

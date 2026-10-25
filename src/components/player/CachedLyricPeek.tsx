import { useEffect, useMemo, useState } from 'react';
import { StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import Animated, {
  Keyframe,
  ReduceMotion,
  useAnimatedReaction,
  useAnimatedStyle,
  useDerivedValue,
  useSharedValue,
  type SharedValue,
} from 'react-native-reanimated';
import { Text } from '@/components/Text';
import { GradientMask } from '@/components/GradientMask';
import { TactilePressable } from '@/components/player/TactilePressable';
import {
  applyPlaybackSnapshot,
  createPlaybackClock,
  projectPlaybackClock,
} from '@/audio/playbackClock';
import { useAnimatedPlaybackProgress } from '@/audio/useAnimatedPlaybackProgress';
import { lyricWordEndMs, lyricWordProgress } from '@/lyrics/animation';
import { peekCachedLyricsForTrack } from '@/lyrics/lyrics';
import {
  getActiveSyncedLyricsLine,
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

const ENTERING = new Keyframe({
  0: { opacity: 0, transform: [{ translateY: 6 }] },
  100: { opacity: 1, transform: [{ translateY: 0 }] },
})
  .duration(190)
  .reduceMotion(ReduceMotion.System);

const EXITING = new Keyframe({
  0: { opacity: 1, transform: [{ translateY: 0 }] },
  100: { opacity: 0, transform: [{ translateY: -6 }] },
})
  .duration(160)
  .reduceMotion(ReduceMotion.System);

/**
 * How often the active line is re-checked while playing. The check is cheap;
 * what matters is that the component only re-renders when the line changes.
 * It used to follow a 15Hz smooth clock and re-render on every tick (~33
 * renders per skip in the trace, 2026-10-02) to show a line that changes every
 * few seconds.
 */
const LINE_POLL_MS = 100;

/**
 * The synced line at the current playback position, re-rendering only when it
 * changes. Reads the position from the store directly rather than through a
 * selector, so the 2Hz progress mirror does not re-render the peek either.
 */
function useActiveLyricLine(
  lines: LyricsLine[] | null,
  duration: number,
  isPlaying: boolean
): LyricsLine | null {
  const [line, setLine] = useState<LyricsLine | null>(null);
  useEffect(() => {
    if (!lines) {
      queueMicrotask(() => setLine(null));
      return undefined;
    }
    let clock = createPlaybackClock(usePlayerStore.getState().currentTime, duration, isPlaying);
    const update = () => {
      const time = projectPlaybackClock(clock, duration, Date.now());
      const next = getActiveSyncedLyricsLine(lines, time + LYRICS_DISPLAY_LEAD_MS / 1000, {
        durationSeconds: duration,
      });
      setLine((previous) => (previous === next ? previous : next));
    };
    const unsubscribe = usePlayerStore.subscribe((state, previous) => {
      if (state.currentTime === previous.currentTime) return;
      clock = applyPlaybackSnapshot(clock, state.currentTime, duration, Date.now());
      update();
    });
    queueMicrotask(update);
    const poll = isPlaying ? setInterval(update, LINE_POLL_MS) : null;
    return () => {
      unsubscribe();
      if (poll) clearInterval(poll);
    };
  }, [duration, isPlaying, lines]);
  return line;
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
          <Text numberOfLines={1} adjustsFontSizeToFit style={[styles.line, styles.sung]}>
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
      {/* Android lays the text out at floor(width), and the row's pixel rounding
          can leave a word one pixel short of what it measured. A trailing space
          hangs past that, but a line's last word has none, so it ellipsized
          ("droppi…"). Fitting shrinks it about a pixel instead, as the lyrics
          view's words already do. */}
      <Text numberOfLines={1} adjustsFontSizeToFit style={styles.line}>
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
          text={word.text}
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
  const activeLine = useActiveLyricLine(syncedLines, duration, isPlaying);
  const text = activeLine?.text.trim() || null;
  const lineKey = text
    ? `${track.path}:${activeLine?.timestampMs ?? -1}:${text}`
    : null;

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
  const [overflowed, setOverflowed] = useState<string | null>(null);
  const fitKey = `${lineKey}:${lines}`;
  const sweeping =
    sweepEnabled && !!activeLine?.words?.length && overflowed !== fitKey;

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
        {text && lineKey ? (
          <Animated.View
            key={lineKey}
            entering={ENTERING}
            exiting={EXITING}
            pointerEvents="none"
            style={styles.lineFrame}
          >
            {sweeping && activeLine ? (
              <PeekWords
                line={activeLine}
                endMs={endMs}
                lines={lines}
                seconds={seconds}
                onOverflow={() => setOverflowed(fitKey)}
              />
            ) : (
              <Text
                numberOfLines={lines}
                ellipsizeMode="tail"
                style={styles.line}
              >
                {text}
              </Text>
            )}
          </Animated.View>
        ) : null}
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

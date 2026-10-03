import { useEffect, useState } from 'react';
import { View } from 'react-native';
import Animated, { Keyframe, ReduceMotion } from 'react-native-reanimated';
import { Text } from '@/components/Text';
import { TactilePressable } from '@/components/player/TactilePressable';
import {
  applyPlaybackSnapshot,
  createPlaybackClock,
  projectPlaybackClock,
} from '@/audio/playbackClock';
import { peekCachedLyricsForTrack } from '@/lyrics/lyrics';
import {
  getActiveSyncedLyricsLine,
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

  return (
    <View style={[styles.wrap, lines > 1 && styles.overflowing, { height }]}>
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
            <Text
              numberOfLines={lines}
              ellipsizeMode="tail"
              style={styles.line}
            >
              {text}
            </Text>
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
}));

import { memo, useMemo } from 'react';
import { runOnJS, useAnimatedReaction, type SharedValue } from 'react-native-reanimated';
import { useAnimatedPlaybackProgress } from '@/audio/useAnimatedPlaybackProgress';
import { getLyricsTimingBoundaries, lyricsTimingAt, sameSyncedLyricsTiming, LYRICS_DISPLAY_LEAD_MS, type SyncedLyricsTimingState } from '@/lyrics/presentation';
import type { LyricsLine } from '@/lyrics/types';

/** Words, emphasis and following share one UI clock. JS receives only cue
 * changes, never an independently projected time or a per-frame word prop. */
export const LyricsPlaybackClock = memo(function LyricsPlaybackClock({
  lines, path, currentTime, duration, isPlaying, active, seconds, changed,
}: {
  lines: LyricsLine[]; path: string; currentTime: number; duration: number;
  isPlaying: boolean; active: boolean; seconds: SharedValue<number>;
  changed: (timing: SyncedLyricsTimingState) => void;
}) {
  const progress = useAnimatedPlaybackProgress({ currentTime, duration, isPlaying, active, trackKey: path });
  const boundaries = useMemo(() => getLyricsTimingBoundaries(lines, { durationSeconds: duration }), [lines, duration]);
  useAnimatedReaction(() => {
    const time = duration > 0 ? progress.value * duration : currentTime;
    return isPlaying && active ? Math.floor(time * 30) / 30 : time;
  }, time => { seconds.set(time + LYRICS_DISPLAY_LEAD_MS / 1000); }, [duration, currentTime, isPlaying, active]);
  useAnimatedReaction(() => lyricsTimingAt(boundaries, seconds.value), (next, previous) => {
    if (!sameSyncedLyricsTiming(next, previous)) runOnJS(changed)(next);
  }, [boundaries, seconds, changed]);
  return null;
});

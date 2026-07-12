import { useEffect, useMemo, useState } from 'react';
import { View } from 'react-native';
import Animated, { Keyframe, ReduceMotion } from 'react-native-reanimated';
import { TactilePressable } from '@/components/player/TactilePressable';
import { useSmoothPlaybackTime } from '@/audio/useSmoothPlaybackTime';
import { peekCachedLyricsForTrack } from '@/lyrics/lyrics';
import {
  getActiveSyncedLyricsLine,
  LYRICS_DISPLAY_LEAD_MS,
} from '@/lyrics/presentation';
import { fonts, spacing } from '@/theme';
import { createThemedStyles } from '@/theme/themed';
import { useLyricsStore } from '@/stores/lyricsStore';
import { usePlayerStore } from '@/stores/playerStore';
import type { LyricsLookupResult } from '@/lyrics/types';
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

interface CachedLyricPeekProps {
  track: Track;
  active: boolean;
  hidden?: boolean;
  onOpenLyrics: () => void;
}

/**
 * One-line synced lyric display. It consumes an existing in-memory result or a
 * cache-only SQLite read; it never initiates media scanning or provider work.
 */
export function CachedLyricPeek({
  track,
  active,
  hidden = false,
  onOpenLyrics,
}: CachedLyricPeekProps) {
  const styles = useStyles();
  const memoryResult = useLyricsStore((s) => s.byPath[track.path]?.result ?? null);
  const [cached, setCached] = useState<{
    path: string;
    result: LyricsLookupResult | null;
  } | null>(null);
  const currentTime = usePlayerStore((s) => (active ? s.currentTime : 0));
  const duration = usePlayerStore((s) => s.duration);
  const isPlaying = usePlayerStore(
    (s) => active && s.playbackState === 'playing'
  );
  const smoothTime = useSmoothPlaybackTime(currentTime, duration, isPlaying);

  useEffect(() => {
    if (!active || memoryResult) return;
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
  }, [active, memoryResult, track]);

  const storedResult = cached?.path === track.path ? cached.result : null;
  const result = memoryResult?.status === 'hit' ? memoryResult : storedResult;
  const activeLine = useMemo(() => {
    if (hidden || result?.status !== 'hit') return null;
    return getActiveSyncedLyricsLine(
      result.lyrics.syncedLines,
      smoothTime + LYRICS_DISPLAY_LEAD_MS / 1000,
      { durationSeconds: duration }
    );
  }, [duration, hidden, result, smoothTime]);
  const text = activeLine?.text.trim() || null;
  const lineKey = text
    ? `${track.path}:${activeLine?.timestampMs ?? -1}:${text}`
    : null;

  return (
    <View style={styles.wrap}>
      <TactilePressable
        style={styles.pressable}
        disabled={!text}
        haptic="selection"
        onPress={onOpenLyrics}
        accessibilityRole={text ? 'button' : undefined}
        accessibilityLabel={text ? `Open lyrics: ${text}` : undefined}
      >
        {text && lineKey ? (
          <Animated.Text
            key={lineKey}
            entering={ENTERING}
            exiting={EXITING}
            numberOfLines={1}
            ellipsizeMode="tail"
            style={styles.line}
          >
            {text}
          </Animated.Text>
        ) : null}
      </TactilePressable>
    </View>
  );
}

const useStyles = createThemedStyles((colors) => ({
  wrap: {
    height: 28,
    marginBottom: spacing.sm,
    overflow: 'hidden',
  },
  pressable: {
    flex: 1,
    justifyContent: 'center',
    overflow: 'hidden',
  },
  line: {
    position: 'absolute',
    left: 0,
    right: 0,
    color: colors.textSecondary,
    fontFamily: fonts.sans.medium,
    fontSize: 16,
    lineHeight: 22,
  },
}));

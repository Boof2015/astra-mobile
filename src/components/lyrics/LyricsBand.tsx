// The scrolling synced-lyrics list for lyrics mode. Fills its parent (flex:1),
// left-aligned, self-measuring. The active line advances off the same smooth
// playback clock the waveform uses (RNTP stays authoritative) and auto-scrolls to
// a comfortable reading anchor; manual scroll pauses the follow and surfaces a
// Recenter pill. Top/bottom gradient overlays soften the edges into the chrome
// (react-native-svg — no native rebuild). Plain (unsynced) hits render as a
// static scroll; loading/not-found/error states get a centered message.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, View, type LayoutChangeEvent } from 'react-native';
import { Text } from '@/components/Text';
import { useColors } from '@/theme/themed';
import { useSmoothPlaybackTime } from '@/audio/useSmoothPlaybackTime';
import { useLyricsStore } from '@/stores/lyricsStore';
import {
  getLyricsLineSeekTimeSeconds,
  getSyncedLyricsDisplayLines,
  getSyncedLyricsGapProgress,
  hasRenderableSyncedLines,
  resolveSyncedLyricsTiming,
} from '@/lyrics/presentation';
import { LyricsLine, type LyricsLineTier } from './LyricsLine';
import type { Track } from '@/types/audio';

const TRANSLATION_PRIORITY = ['en', 'ja-Latn'];
const ANCHOR_RATIO = 0.4;
const H_PADDING = 22;
// The displayed active line lags the audio by a fixed pipeline delay (RNTP
// position reporting + poll/smoothing) that the desktop doesn't have, so advance
// the lyrics clock by this much. Tune to taste — bigger = earlier highlight.
const LYRICS_LEAD_MS = 350;

interface LyricsBandProps {
  track: Track;
  currentTime: number;
  duration: number;
  isPlaying: boolean;
  onSeek: (seconds: number) => void;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function LyricsBand({ track, currentTime, duration, isPlaying, onSeek }: LyricsBandProps) {
  const colors = useColors();
  const entry = useLyricsStore((s) => s.byPath[track.path]);
  const loadForTrack = useLyricsStore((s) => s.loadForTrack);

  useEffect(() => {
    void loadForTrack(track);
  }, [track, loadForTrack]);

  const [size, setSize] = useState({ w: 0, h: 0 });
  const onContainerLayout = (event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    setSize((prev) => (prev.w === width && prev.h === height ? prev : { w: width, h: height }));
  };

  const smoothTime = useSmoothPlaybackTime(currentTime, duration, isPlaying);
  // Lead the audio to counter display-pipeline lag (see LYRICS_LEAD_MS).
  const lyricsTime = smoothTime + LYRICS_LEAD_MS / 1000;
  const result = entry?.result ?? null;
  const isLoading = entry?.loading ?? !entry;

  const syncedLines = useMemo(
    () => (result?.status === 'hit' ? result.lyrics.syncedLines : []),
    [result]
  );
  const displayLines = useMemo(
    () => getSyncedLyricsDisplayLines(syncedLines, { durationSeconds: duration }),
    [syncedLines, duration]
  );
  const hasSynced = hasRenderableSyncedLines(syncedLines);
  const timing = resolveSyncedLyricsTiming(syncedLines, lyricsTime, { durationSeconds: duration });
  const focusIndex = timing.focusLineIndex;

  // Uniform size for every line (LyricsLine no longer scales font per tier), so pick
  // a comfortable reading size rather than the old oversized active value.
  const baseSize = size.w > 0 ? Math.round(clamp(size.w * 0.058, 18, 24)) : 22;

  // --- auto-scroll centering ---
  const scrollRef = useRef<ScrollView>(null);
  const offsets = useRef<number[]>([]);
  const heights = useRef<number[]>([]);
  const [followPaused, setFollowPaused] = useState(false);

  const centerOn = useCallback(
    (displayIndex: number, animated: boolean) => {
      if (displayIndex < 0 || size.h <= 0) return;
      const y = offsets.current[displayIndex];
      const h = heights.current[displayIndex];
      if (y == null || h == null) return;
      const target = Math.max(0, y + h / 2 - size.h * ANCHOR_RATIO);
      scrollRef.current?.scrollTo({ y: target, animated });
    },
    [size.h]
  );

  // Reset follow + jump to the focus line when the track (or its lyrics) changes.
  useEffect(() => {
    offsets.current = [];
    heights.current = [];
    const timer = setTimeout(() => {
      setFollowPaused(false);
      centerOn(timing.focusLineIndex, false);
    }, 90);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [track.path, displayLines.length]);

  // Follow the active/focus line as playback advances.
  useEffect(() => {
    if (followPaused) return;
    centerOn(focusIndex, true);
  }, [focusIndex, followPaused, centerOn]);

  const recenter = useCallback(() => {
    setFollowPaused(false);
    centerOn(focusIndex, true);
  }, [centerOn, focusIndex]);

  const message = !hasSynced
    ? result?.status === 'transient_error'
      ? 'Lyrics lookup ran into a problem. A retry may work.'
      : result?.status === 'not_found'
        ? result.reason === 'online-disabled'
          ? 'Online lyrics lookup is off.'
          : result.reason === 'provider-unavailable'
            ? "Lyrics providers didn't respond in time."
            : 'No lyrics found for this track.'
        : isLoading
          ? 'Finding lyrics…'
          : 'Lyrics are ready when a track is playing.'
    : null;

  // --- plain (unsynced) hit ---
  if (result?.status === 'hit' && !hasSynced) {
    return (
      <View style={{ flex: 1 }} onLayout={onContainerLayout}>
        <ScrollView
          contentContainerStyle={{ paddingVertical: 24, paddingHorizontal: H_PADDING }}
          showsVerticalScrollIndicator={false}
        >
          <Text variant="body" color={colors.textSecondary} style={{ lineHeight: 28 }}>
            {result.lyrics.plainLyrics ?? ''}
          </Text>
        </ScrollView>
      </View>
    );
  }

  // --- loading / not-found / error ---
  if (!hasSynced) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 28 }}>
        <Text variant="body" color={colors.textTertiary} style={{ textAlign: 'center' }}>
          {message}
        </Text>
      </View>
    );
  }

  // --- synced view ---
  return (
    <View style={{ flex: 1 }} onLayout={onContainerLayout}>
      <ScrollView
        ref={scrollRef}
        showsVerticalScrollIndicator={false}
        scrollEventThrottle={16}
        onScrollBeginDrag={() => setFollowPaused(true)}
        contentContainerStyle={{
          paddingVertical: size.h > 0 ? Math.round(size.h * ANCHOR_RATIO) : 120,
          paddingHorizontal: H_PADDING,
          alignItems: 'stretch',
        }}
      >
        {displayLines.map((displayLine) => {
          const onLayout = (event: LayoutChangeEvent) => {
            offsets.current[displayLine.displayIndex] = event.nativeEvent.layout.y;
            heights.current[displayLine.displayIndex] = event.nativeEvent.layout.height;
          };

          if (displayLine.kind === 'gap') {
            const progress = getSyncedLyricsGapProgress(displayLine, lyricsTime) ?? 0;
            const isCurrentGap = displayLine.displayIndex === focusIndex && timing.isNeutral;
            return (
              <View
                key={displayLine.key}
                onLayout={onLayout}
                style={{ paddingVertical: 16, opacity: isCurrentGap ? 0.9 : 0.25 }}
              >
                <View
                  style={{
                    width: clamp(size.w * 0.3, 110, 220),
                    height: 3,
                    borderRadius: 2,
                    backgroundColor: colors.glassBorder,
                    overflow: 'hidden',
                  }}
                >
                  <View style={{ width: `${Math.round(progress * 100)}%`, height: 3, backgroundColor: colors.textSecondary }} />
                </View>
              </View>
            );
          }

          const distance = displayLine.displayIndex - focusIndex;
          const isActive = !timing.isNeutral && displayLine.displayIndex === timing.activeLineIndex;
          const absDistance = Math.abs(distance);
          const tier: LyricsLineTier = isActive ? 'active' : absDistance <= 1 ? 'near' : absDistance === 2 ? 'far' : 'distant';
          const seekSeconds = getLyricsLineSeekTimeSeconds(displayLine.timestampMs, duration, 0);

          return (
            <LyricsLine
              key={displayLine.key}
              line={displayLine.line}
              tier={tier}
              baseSize={baseSize}
              translationPriority={TRANSLATION_PRIORITY}
              onSeek={() => {
                if (seekSeconds != null) onSeek(seekSeconds);
              }}
              onLayout={onLayout}
            />
          );
        })}
      </ScrollView>

      {followPaused ? (
        <Pressable
          onPress={recenter}
          hitSlop={10}
          style={{
            position: 'absolute',
            bottom: 8,
            alignSelf: 'center',
            paddingHorizontal: 14,
            paddingVertical: 5,
            borderRadius: 999,
            borderWidth: 1,
            borderColor: colors.accent,
            backgroundColor: colors.glassBg,
          }}
        >
          <Text variant="mono" color={colors.accentText} style={{ fontSize: 9, letterSpacing: 1, textTransform: 'uppercase' }}>
            Recenter
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

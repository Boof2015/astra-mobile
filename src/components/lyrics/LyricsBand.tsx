// The scrolling synced-lyrics list for lyrics mode. Fills its parent (flex:1),
// left-aligned, self-measuring. The active line advances off the same smooth
// playback clock the waveform uses (RNTP stays authoritative) and auto-scrolls to
// a comfortable reading anchor; manual scroll pauses the follow and surfaces a
// Recenter pill. Top/bottom gradient overlays soften the edges into the chrome
// (react-native-svg — no native rebuild). Plain (unsynced) hits render as a
// static scroll; loading/not-found/error states get a centered message.
import { ActionButton } from '@/components/ActionButton';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ScrollView, View, type LayoutChangeEvent } from 'react-native';
import { Text } from '@/components/Text';
import { spacing } from '@/theme';
import { useColors } from '@/theme/themed';
import { SCROLL_PRESS_DELAY } from '@/components/AppPressable';
import { useSmoothPlaybackTime } from '@/audio/useSmoothPlaybackTime';
import { useLyricsStore } from '@/stores/lyricsStore';
import { useLyricsSettingsStore } from '@/stores/lyricsSettingsStore';
import {
  getLyricsEmptyStatePresentation,
  getLyricsLineSeekTimeSeconds,
  getSyncedLyricsDisplayLines,
  getSyncedLyricsGapProgress,
  hasRenderableSyncedLines,
  LYRICS_DISPLAY_LEAD_MS,
  resolveSyncedLyricsTiming,
} from '@/lyrics/presentation';
import { LyricsLine, type LyricsLineTier } from './LyricsLine';
import type { Track } from '@/types/audio';

const ANCHOR_RATIO = 0.4;
const H_PADDING = 22;

/**
 * Type sizing per surface.
 *
 * The phone body scales its type with its column, which is fine when the column
 * is the whole screen — there is no other use for the width.
 *
 * A pane must not do that. Scaling type with width means widening the pane
 * spends the new space on bigger glyphs and every line still breaks in the same
 * place: going 504 → 576dp took the type 29pt → 32pt and changed nothing about
 * the wrapping. So the pane declares its size and lets width buy *characters*,
 * which is the only thing that actually stops a line breaking mid-phrase.
 */
interface LyricsSurfaceSpec {
  /** Declared point size; `null` scales with the column instead. */
  fixedSize: number | null;
  /** Ceiling for the scaled path. */
  maxSize: number;
  hPadding: number;
}
const SURFACE: Record<'band' | 'panel', LyricsSurfaceSpec> = {
  band: { fixedSize: null, maxSize: 24, hPadding: H_PADDING },
  panel: { fixedSize: 26, maxSize: 26, hPadding: 28 },
};

export type LyricsSurface = keyof typeof SURFACE;
// The displayed active line lags the audio by a fixed pipeline delay (RNTP
// position reporting + poll/smoothing) that the desktop doesn't have, so advance
// the lyrics clock by this much. Tune to taste — bigger = earlier highlight.

interface LyricsBandProps {
  track: Track;
  currentTime: number;
  duration: number;
  isPlaying: boolean;
  onSeek: (seconds: number) => void;
  /** `panel` is the tablet companion column; `band` is the phone body. */
  surface?: LyricsSurface;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function LyricsBand({
  track,
  currentTime,
  duration,
  isPlaying,
  onSeek,
  surface = 'band',
}: LyricsBandProps) {
  const { fixedSize, maxSize, hPadding } = SURFACE[surface];
  const colors = useColors();
  const entry = useLyricsStore((s) => s.byPath[track.path]);
  const loadForTrack = useLyricsStore((s) => s.loadForTrack);
  const wordTimingEnabled = useLyricsSettingsStore((s) => s.wordTimingEnabled);
  const furiganaEnabled = useLyricsSettingsStore((s) => s.furiganaEnabled);
  const translationsEnabled = useLyricsSettingsStore((s) => s.translationsEnabled);
  const translationPriority = useLyricsSettingsStore((s) => s.translationPriority);
  const voiceLabelsEnabled = useLyricsSettingsStore((s) => s.voiceLabelsEnabled);

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
  const lyricsTime = smoothTime + LYRICS_DISPLAY_LEAD_MS / 1000;
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
  const baseSize =
    fixedSize ?? (size.w > 0 ? Math.round(clamp(size.w * 0.058, 18, maxSize)) : 22);

  // --- auto-scroll centering ---
  const scrollRef = useRef<ScrollView>(null);
  const offsets = useRef<number[]>([]);
  const heights = useRef<number[]>([]);
  const followContext = useMemo(() => ({
    trackPath: track.path, displayLines, furiganaEnabled, translationsEnabled,
    translationPriority, voiceLabelsEnabled, wordTimingEnabled,
  }), [track.path, displayLines, furiganaEnabled,
    translationsEnabled, translationPriority, voiceLabelsEnabled, wordTimingEnabled]);
  const [pausedContext, setPausedContext] = useState<typeof followContext | null>(null);
  const followPaused = pausedContext === followContext;
  const initialCenterPending = useRef(true);
  const layoutFrame = useRef<number | null>(null);
  const centerAfterLayout = useRef<() => void>(() => {});

  const centerOn = useCallback(
    (displayIndex: number, animated: boolean) => {
      if (displayIndex < 0 || size.h <= 0) return;
      const y = offsets.current[displayIndex];
      const h = heights.current[displayIndex];
      if (y == null || h == null || !scrollRef.current) return;
      const target = Math.max(0, y + h / 2 - size.h * ANCHOR_RATIO);
      scrollRef.current.scrollTo({ y: target, animated });
      initialCenterPending.current = false;
    },
    [size.h]
  );

  // Row measurements can arrive after the container (or vice versa). Retry
  // after the layout batch, using the latest clock and viewport. A fixed delay
  // could miss that first layout and leave lyrics at the top until the next line.
  const scheduleLayoutCenter = useCallback(() => {
    if (layoutFrame.current !== null) return;
    layoutFrame.current = requestAnimationFrame(() => {
      layoutFrame.current = null;
      centerAfterLayout.current();
    });
  }, []);

  useLayoutEffect(() => {
    centerAfterLayout.current = () => {
      if (!followPaused) centerOn(focusIndex, false);
    };
  }, [centerOn, focusIndex, followPaused]);

  useLayoutEffect(() => {
    initialCenterPending.current = true;
    scheduleLayoutCenter();
  }, [followContext, scheduleLayoutCenter]);

  useEffect(() => () => {
    if (layoutFrame.current !== null) cancelAnimationFrame(layoutFrame.current);
  }, []);

  // Follow the active/focus line as playback advances.
  useEffect(() => {
    if (followPaused) return;
    centerOn(focusIndex, !initialCenterPending.current);
  }, [focusIndex, followPaused, centerOn]);

  const recenter = useCallback(() => {
    setPausedContext(null);
    centerOn(focusIndex, true);
  }, [centerOn, focusIndex]);

  const emptyState = getLyricsEmptyStatePresentation({ result, isLoading });

  // --- plain (unsynced) hit ---
  if (result?.status === 'hit' && !hasSynced) {
    return (
      <View style={{ flex: 1 }} onLayout={onContainerLayout}>
        <ScrollView
          contentContainerStyle={{ paddingVertical: 24, paddingHorizontal: hPadding }}
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
      <View
        style={{
          flex: 1,
          alignItems: 'center',
          justifyContent: 'center',
          gap: spacing.md,
          paddingHorizontal: 28,
        }}
      >
        <Text variant="body" color={colors.textTertiary} style={{ textAlign: 'center' }}>
          {emptyState.message}
        </Text>
        {emptyState.retryable ? (
          <ActionButton
            disabled={isLoading}
            onPress={() => void loadForTrack(track, { force: true })}
            accessibilityLabel="Retry lyrics lookup"
            accessibilityState={{ disabled: isLoading, busy: isLoading }}
            variant="secondary"
            label={isLoading ? 'Retrying…' : 'Retry'}
            icon="refresh"
            iconSize={16}
            loading={isLoading}
          />
        ) : null}
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
        onScrollBeginDrag={() => setPausedContext(followContext)}
        onContentSizeChange={scheduleLayoutCenter}
        contentContainerStyle={{
          paddingVertical: size.h > 0 ? Math.round(size.h * ANCHOR_RATIO) : 120,
          paddingHorizontal: hPadding,
          alignItems: 'stretch',
        }}
      >
        {displayLines.map((displayLine) => {
          const onLayout = (event: LayoutChangeEvent) => {
            offsets.current[displayLine.displayIndex] = event.nativeEvent.layout.y;
            heights.current[displayLine.displayIndex] = event.nativeEvent.layout.height;
            scheduleLayoutCenter();
          };

          if (displayLine.kind === 'gap') {
            const isCurrentGap = displayLine.displayIndex === focusIndex && timing.isNeutral;
            const progress = isCurrentGap ? getSyncedLyricsGapProgress(displayLine, lyricsTime) ?? 0 : 0;
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
              roomy={surface === 'band'}
              browsing={surface === 'band' && followPaused}
              activeTimeSeconds={isActive && wordTimingEnabled ? lyricsTime : null}
              wordTimingEnabled={wordTimingEnabled}
              furiganaEnabled={furiganaEnabled}
              translationsEnabled={translationsEnabled}
              translationPriority={translationPriority}
              voiceLabelsEnabled={voiceLabelsEnabled}
              onSeek={() => {
                if (seekSeconds != null) onSeek(seekSeconds);
              }}
              onLayout={onLayout}
            />
          );
        })}
      </ScrollView>

      {followPaused ? (
        <ActionButton
          unstable_pressDelay={SCROLL_PRESS_DELAY}
          onPress={recenter}
          accessibilityLabel="Recenter lyrics on the current line"
          hitSlop={10}
          variant="secondary"
          label="Recenter"
          style={{ position: 'absolute', bottom: 8, alignSelf: 'center' }}
        />
      ) : null}
    </View>
  );
}

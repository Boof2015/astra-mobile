// Shared phone/tablet lyrics surface. Continuous playback work is isolated in
// SyncedLyrics; the surrounding player only provides authoritative snapshots.
import { ActionButton } from '@/components/ActionButton';
import { useEffect, useMemo, useState } from 'react';
import { ScrollView, View, useWindowDimensions, type LayoutChangeEvent } from 'react-native';
import { Text } from '@/components/Text';
import { spacing, MAX_FONT_SCALE } from '@/theme';
import { useColors } from '@/theme/themed';
import { useLyricsStore } from '@/stores/lyricsStore';
import { useLyricsSettingsStore } from '@/stores/lyricsSettingsStore';
import { getLyricsEmptyStatePresentation, hasRenderableSyncedLines } from '@/lyrics/presentation';
import { SyncedLyrics } from './SyncedLyrics';
import type { Track } from '@/types/audio';

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
interface LyricsBandProps {
  track: Track;
  currentTime: number;
  duration: number;
  isPlaying: boolean;
  active: boolean;
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
  active,
  onSeek,
  surface = 'band',
}: LyricsBandProps) {
  const { fixedSize, maxSize, hPadding } = SURFACE[surface];
  const colors = useColors();
  const { fontScale } = useWindowDimensions();
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

  const result = entry?.result ?? null;
  const isLoading = entry?.loading ?? !entry;

  const syncedLines = useMemo(
    () => (result?.status === 'hit' ? result.lyrics.syncedLines : []),
    [result]
  );
  const hasSynced = hasRenderableSyncedLines(syncedLines);
  const settings = useMemo(() => ({ wordTimingEnabled, furiganaEnabled, translationsEnabled, translationPriority, voiceLabelsEnabled }),
    [wordTimingEnabled, furiganaEnabled, translationsEnabled, translationPriority, voiceLabelsEnabled]);
  // Uniform size for every line (LyricsLine no longer scales font per tier), so pick
  // a comfortable reading size rather than the old oversized active value.
  const baseSize =
    fixedSize ?? (size.w > 0 ? Math.round(clamp(size.w * 0.058, 18, maxSize)) : 22);

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

  const textSize = baseSize * Math.min(MAX_FONT_SCALE, fontScale);
  return (
    <View style={{ flex: 1 }} onLayout={onContainerLayout}>
      {size.w > hPadding * 2 && size.h > 0 && <SyncedLyrics
        key={JSON.stringify([track.path, size.w, size.h, textSize, settings])}
        path={track.path} lines={syncedLines} currentTime={currentTime} duration={duration}
        isPlaying={isPlaying} active={active} width={size.w} height={size.h} size={textSize}
        padding={hPadding} settings={settings} onSeek={onSeek}
      />}
    </View>
  );
}

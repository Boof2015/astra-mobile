// One synced lyric line for the now-playing lyrics view. Left-aligned (mobile /
// Apple-Music reading style), with furigana ruby columns when present and an
// optional translation line beneath. Tapping seeks to the line.
//
// Every line uses the SAME font size, weight, and metrics, so text wrapping and
// line heights are identical across tiers — the layout never reflows as the active
// line moves, which is what caused the surrounding lines to shift/flicker. The
// active line is emphasized only by opacity, a small scale, and an accent glow —
// all paint/transform, never layout — and both animate so tier changes ease
// instead of snapping.
//
// RN has no <ruby>, so ruby is a stacked column: a small reading Text over the
// base Text. Every segment is the identical box (a View reserving `readingHeight`
// of top space with the base below) so all bases land on one line; the reading is
// absolutely positioned in that top zone, base-width and shrunk to fit, so a wide
// reading never widens the column and spreads the sentence apart.

import { memo, useEffect, useMemo } from 'react';
import { Pressable, View, type LayoutChangeEvent } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { Text } from '@/components/Text';
import { useColors } from '@/theme/themed';
import { getPreferredLyricsTranslation } from '@/lyrics/presentation';
import type { LyricsFurigana, LyricsLine as LyricsLineData } from '@/lyrics/types';

export type LyricsLineTier = 'active' | 'near' | 'far' | 'distant';

interface LyricsLineProps {
  line: LyricsLineData;
  tier: LyricsLineTier;
  baseSize: number;
  translationPriority: string[];
  onSeek: () => void;
  onLayout?: (event: LayoutChangeEvent) => void;
}

// scale/opacity only — never anything that reflows layout. Active scale is kept
// small enough that the grow overflows into the horizontal padding, not off-screen.
const TIER: Record<LyricsLineTier, { scale: number; opacity: number }> = {
  active: { scale: 1.06, opacity: 1 },
  near: { scale: 1.0, opacity: 0.52 },
  far: { scale: 0.965, opacity: 0.27 },
  distant: { scale: 0.93, opacity: 0.13 },
};

const EASE = Easing.bezier(0.22, 1, 0.36, 1);
const DURATION = 220;

interface Segment {
  text: string;
  reading?: string;
}

function buildSegments(text: string, furigana: LyricsFurigana[] | undefined): Segment[] {
  if (!furigana || furigana.length === 0) return [{ text }];
  const sorted = [...furigana].sort((a, b) => a.start - b.start);
  const segments: Segment[] = [];
  let cursor = 0;
  for (const entry of sorted) {
    if (entry.start < cursor || entry.end > text.length) continue;
    if (entry.start > cursor) segments.push({ text: text.slice(cursor, entry.start) });
    segments.push({ text: text.slice(entry.start, entry.end), reading: entry.reading });
    cursor = entry.end;
  }
  if (cursor < text.length) segments.push({ text: text.slice(cursor) });
  return segments;
}

function LyricsLineComponent({ line, tier, baseSize, translationPriority, onSeek, onLayout }: LyricsLineProps) {
  const colors = useColors();
  const target = TIER[tier];
  // Uniform metrics for every line (the whole point — no wrap/reflow between tiers).
  const size = baseSize;
  const lineHeight = Math.round(size * 1.2);
  const readingSize = Math.max(9, Math.round(size * 0.5));
  const readingHeight = Math.round(readingSize * 1.25);
  const translation = useMemo(
    () => getPreferredLyricsTranslation(line, translationPriority),
    [line, translationPriority]
  );
  const hasFurigana = Boolean(line.furigana && line.furigana.length > 0);
  const segments = useMemo(() => buildSegments(line.text, line.furigana), [line.text, line.furigana]);

  const opacity = useSharedValue(target.opacity);
  const scale = useSharedValue(target.scale);
  useEffect(() => {
    opacity.value = withTiming(target.opacity, { duration: DURATION, easing: EASE });
    scale.value = withTiming(target.scale, { duration: DURATION, easing: EASE });
  }, [target.opacity, target.scale, opacity, scale]);
  const animatedStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ scale: scale.value }],
  }));

  const textColor = colors.textPrimary;
  const mainShadow =
    tier === 'active'
      ? { textShadowColor: colors.accentGlow, textShadowOffset: { width: 0, height: 0 }, textShadowRadius: 16 }
      : undefined;

  return (
    <Animated.View onLayout={onLayout} style={[{ width: '100%', transformOrigin: 'left center' }, animatedStyle]}>
      <Pressable onPress={onSeek} style={{ paddingVertical: 7 }}>
        <View style={{ alignItems: 'flex-start' }}>
          {hasFurigana ? (
            <View
              style={{
                flexDirection: 'row',
                flexWrap: 'wrap',
                justifyContent: 'flex-start',
                alignItems: 'flex-start',
              }}
            >
              {segments.map((segment, index) => (
                <View key={index} style={{ paddingTop: readingHeight }}>
                  <Text variant="heading" color={textColor} style={{ fontSize: size, lineHeight, ...mainShadow }}>
                    {segment.text}
                  </Text>
                  {segment.reading ? (
                    <Text
                      variant="caption"
                      color={colors.textSecondary}
                      numberOfLines={1}
                      adjustsFontSizeToFit
                      style={{
                        position: 'absolute',
                        top: 0,
                        left: 0,
                        right: 0,
                        height: readingHeight,
                        fontSize: readingSize,
                        lineHeight: readingHeight,
                        textAlign: 'center',
                      }}
                    >
                      {segment.reading}
                    </Text>
                  ) : null}
                </View>
              ))}
            </View>
          ) : (
            <Text variant="heading" color={textColor} style={{ fontSize: size, lineHeight, textAlign: 'left', ...mainShadow }}>
              {line.text}
            </Text>
          )}

          {translation ? (
            <Text
              variant="body"
              color={colors.textSecondary}
              style={{
                fontSize: Math.max(11, Math.round(size * 0.52)),
                lineHeight: Math.round(size * 0.66),
                textAlign: 'left',
                marginTop: 3,
                opacity: 0.85,
              }}
            >
              {translation.text}
            </Text>
          ) : null}
        </View>
      </Pressable>
    </Animated.View>
  );
}

export const LyricsLine = memo(LyricsLineComponent);

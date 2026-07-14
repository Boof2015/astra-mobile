import { memo, useEffect, useMemo, useState } from 'react';
import { Pressable, View, type LayoutChangeEvent } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { Text } from '@/components/Text';
import { useColors } from '@/theme/themed';
import { SCROLL_PRESS_DELAY, useRipple } from '@/theme/ripple';
import { getPreferredLyricsTranslation, resolveLyricsWordTiming } from '@/lyrics/presentation';
import type { LyricsFurigana, LyricsLine as LyricsLineData, LyricsWord } from '@/lyrics/types';

export type LyricsLineTier = 'active' | 'near' | 'far' | 'distant';

interface LyricsLineProps {
  line: LyricsLineData;
  tier: LyricsLineTier;
  baseSize: number;
  activeTimeSeconds: number | null;
  wordTimingEnabled: boolean;
  furiganaEnabled: boolean;
  translationsEnabled: boolean;
  translationPriority: string[];
  voiceLabelsEnabled: boolean;
  onSeek: () => void;
  onLayout?: (event: LayoutChangeEvent) => void;
}

const TIER: Record<LyricsLineTier, { scale: number; opacity: number }> = {
  active: { scale: 1.06, opacity: 1 },
  near: { scale: 1, opacity: 0.52 },
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
  return segments.length > 0 ? segments : [{ text }];
}

function RubyText({
  text,
  furigana,
  enabled,
  size,
  lineHeight,
  readingSize,
  readingHeight,
  color,
  readingColor,
  shadow,
}: {
  text: string;
  furigana?: LyricsFurigana[];
  enabled: boolean;
  size: number;
  lineHeight: number;
  readingSize: number;
  readingHeight: number;
  color: string;
  readingColor: string;
  shadow?: object;
}) {
  const segments = useMemo(
    () => buildSegments(text, enabled ? furigana : undefined),
    [enabled, furigana, text]
  );
  if (!enabled || !furigana?.length) {
    return <Text variant="heading" color={color} style={{ fontSize: size, lineHeight, ...shadow }}>{text}</Text>;
  }
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'flex-start' }}>
      {segments.map((segment, index) => (
        <View key={`${index}:${segment.text}`} style={{ paddingTop: readingHeight }}>
          <Text variant="heading" color={color} style={{ fontSize: size, lineHeight, ...shadow }}>
            {segment.text}
          </Text>
          {segment.reading ? (
            <Text
              variant="caption"
              color={readingColor}
              numberOfLines={1}
              adjustsFontSizeToFit
              style={{
                position: 'absolute', top: 0, left: 0, right: 0,
                height: readingHeight, fontSize: readingSize,
                lineHeight: readingHeight, textAlign: 'center',
              }}
            >
              {segment.reading}
            </Text>
          ) : null}
        </View>
      ))}
    </View>
  );
}

function TimedWord({
  word,
  progress,
  furiganaEnabled,
  size,
  lineHeight,
  readingSize,
  readingHeight,
}: {
  word: LyricsWord;
  progress: number;
  furiganaEnabled: boolean;
  size: number;
  lineHeight: number;
  readingSize: number;
  readingHeight: number;
}) {
  const colors = useColors();
  const [width, setWidth] = useState(0);
  const hasFurigana = furiganaEnabled && Boolean(word.furigana?.length);
  const textTop = hasFurigana ? readingHeight : 0;
  return (
    <View
      onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
    >
      <RubyText
        text={word.text}
        furigana={word.furigana}
        enabled={furiganaEnabled}
        size={size}
        lineHeight={lineHeight}
        readingSize={readingSize}
        readingHeight={readingHeight}
        color={colors.textPrimary}
        readingColor={colors.textSecondary}
      />
      {width > 0 && progress > 0 ? (
        <View
          pointerEvents="none"
          style={{
            position: 'absolute', left: 0, top: textTop,
            width: width * progress, height: lineHeight, overflow: 'hidden',
          }}
        >
          <Text
            variant="heading"
            color={colors.accentTextStrong}
            numberOfLines={1}
            style={{ width, fontSize: size, lineHeight }}
          >
            {word.text}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

function LyricsLineComponent({
  line,
  tier,
  baseSize,
  activeTimeSeconds,
  wordTimingEnabled,
  furiganaEnabled,
  translationsEnabled,
  translationPriority,
  voiceLabelsEnabled,
  onSeek,
  onLayout,
}: LyricsLineProps) {
  const colors = useColors();
  const ripple = useRipple();
  const target = TIER[tier];
  const size = baseSize;
  const lineHeight = Math.round(size * 1.2);
  const readingSize = Math.max(9, Math.round(size * 0.5));
  const readingHeight = Math.round(readingSize * 1.25);
  const translation = useMemo(
    () => translationsEnabled ? getPreferredLyricsTranslation(line, translationPriority) : null,
    [line, translationPriority, translationsEnabled]
  );
  const words = useMemo(
    () => wordTimingEnabled ? line.words ?? [] : [],
    [line.words, wordTimingEnabled]
  );
  const wordTiming = useMemo(
    () => activeTimeSeconds === null ? null : resolveLyricsWordTiming(words, activeTimeSeconds),
    [activeTimeSeconds, words]
  );

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
  const mainShadow = tier === 'active'
    ? { textShadowColor: colors.accentGlow, textShadowOffset: { width: 0, height: 0 }, textShadowRadius: 16 }
    : undefined;

  return (
    <Animated.View onLayout={onLayout} style={[{ width: '100%', transformOrigin: 'left center' }, animatedStyle]}>
      <Pressable android_ripple={ripple.bounded} unstable_pressDelay={SCROLL_PRESS_DELAY} onPress={onSeek} style={{ paddingVertical: 7 }}>
        <View style={{ alignItems: 'flex-start' }}>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 5 }}>
            {voiceLabelsEnabled && line.voice?.trim() ? (
              <View style={{ borderWidth: 1, borderColor: colors.accent, borderRadius: 999, paddingHorizontal: 5, paddingVertical: 1 }}>
                <Text variant="caption" color={colors.accentTextStrong} style={{ fontSize: Math.max(9, Math.round(size * 0.45)), textTransform: 'uppercase' }}>
                  {line.voice.trim()}
                </Text>
              </View>
            ) : null}
            {words.length > 0 ? (
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'flex-start' }}>
                {words.map((word, index) => (
                  <TimedWord
                    key={`${word.timestampMs}:${index}`}
                    word={word}
                    progress={wordTiming?.progressByIndex[index] ?? 0}
                    furiganaEnabled={furiganaEnabled}
                    size={size}
                    lineHeight={lineHeight}
                    readingSize={readingSize}
                    readingHeight={readingHeight}
                  />
                ))}
              </View>
            ) : (
              <RubyText
                text={line.text}
                furigana={line.furigana}
                enabled={furiganaEnabled}
                size={size}
                lineHeight={lineHeight}
                readingSize={readingSize}
                readingHeight={readingHeight}
                color={colors.textPrimary}
                readingColor={colors.textSecondary}
                shadow={mainShadow}
              />
            )}
          </View>
          {translation ? (
            <Text
              variant="body"
              color={colors.textSecondary}
              style={{ fontSize: Math.max(11, Math.round(size * 0.52)), lineHeight: Math.round(size * 0.66), marginTop: 3, opacity: 0.85 }}
            >
              {translation.text}
            </Text>
          ) : null}
        </View>
      </Pressable>
    </Animated.View>
  );
}

function sameLyricsLineProps(previous: LyricsLineProps, next: LyricsLineProps): boolean {
  return previous.line === next.line
    && previous.tier === next.tier
    && previous.baseSize === next.baseSize
    && previous.activeTimeSeconds === next.activeTimeSeconds
    && previous.wordTimingEnabled === next.wordTimingEnabled
    && previous.furiganaEnabled === next.furiganaEnabled
    && previous.translationsEnabled === next.translationsEnabled
    && previous.translationPriority === next.translationPriority
    && previous.voiceLabelsEnabled === next.voiceLabelsEnabled;
}

export const LyricsLine = memo(LyricsLineComponent, sameLyricsLineProps);

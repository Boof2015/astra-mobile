import { memo, useCallback, useMemo, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { useAnimatedReaction, useAnimatedStyle, useDerivedValue, useSharedValue, withTiming, type SharedValue } from 'react-native-reanimated';
import { Text } from '@/components/Text';
import { GradientMask } from '@/components/GradientMask';
import { AppPressable, SCROLL_PRESS_DELAY } from '@/components/AppPressable';
import { useColors } from '@/theme/themed';
import { rgbaFromHex } from '@/theme/colorUtils';
import { getPreferredLyricsTranslation } from '@/lyrics/presentation';
import { balancedLyricWidth, lyricUnits, lyricWordEndMs, lyricWordProgress, MOBILE_LYRICS_MOTION, type LyricUnit } from '@/lyrics/animation';
import { sameLyricsLinePresentation, type LyricsLinePresentation } from './lyricsLinePresentation';
import { LYRICS_EASE } from './useLyricsFollow';

interface UnitStyle {
  size: number;
  width: number;
  color: string;
  glow: string;
}

/** Half-size ruby, as Japanese is typeset (desktop's rt is .46em). Readings
 * were .38 and shrunk to their base's width, so 私[わたし] drew at ~8dp. */
const READING_SCALE = .5;
const READING_ZONE = .62;

/** Size includes the app's capped font scale, keeping text, readings and the
 * sweep on exactly the same measured grid. Every segment is the same box, its
 * base text starting READING_ZONE down, so all bases share one baseline. A
 * reading wider than its base widens the box, as browser ruby does, instead of
 * shrinking. */
const UnitText = memo(function UnitText({ unit, band, appearance, glow = false }: {
  unit: LyricUnit; band: boolean; appearance: UnitStyle; glow?: boolean;
}) {
  const { size, color } = appearance;
  const readingHeight = size * READING_ZONE;
  return <View style={{ flexDirection: 'row' }}>
    {unit.segments.map((segment, index) => <View key={index}
      style={{ flexShrink: 1, alignItems: 'center', paddingTop: band && !segment.reading ? readingHeight : 0 }}>
      {!!segment.reading && <Text variant="label" allowFontScaling={false} color={color} numberOfLines={1}
        style={{ height: readingHeight, fontSize: size * READING_SCALE, lineHeight: readingHeight, textAlign: 'center', includeFontPadding: false }}>
        {segment.reading}
      </Text>}
      <Text variant="heading" allowFontScaling={false} color={color} numberOfLines={1} adjustsFontSizeToFit
        style={{ fontSize: size, lineHeight: size * 1.34, letterSpacing: size * -.012, includeFontPadding: false,
          ...(glow ? { textShadowColor: appearance.glow, textShadowRadius: size * 8 / 30, textShadowOffset: { width: 0, height: 0 } } : {}) }}>
        {segment.text}
      </Text>
    </View>)}
  </View>;
});

function WordLight({ unit, band, appearance, width, height, progress }: {
  unit: LyricUnit; band: boolean; appearance: UnitStyle; width: number; height: number; progress: SharedValue<number>;
}) {
  const feather = appearance.size * 16 / 30;
  const sweep = useAnimatedStyle(() => ({ transform: [{ translateX: -width - feather + progress.value * (width + feather) }] }));
  const glyph = useAnimatedStyle(() => ({ transform: [{ translateX: width + feather - progress.value * (width + feather) }] }));
  return <Animated.View pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={[StyleSheet.absoluteFill, sweep]}>
    <GradientMask width={width + feather} height={height} horizontal stops={[0, 0, width / (width + feather), 1]}>
      <Animated.View style={[{ width }, glyph]}><UnitText unit={unit} band={band} appearance={appearance} /></Animated.View>
    </GradientMask>
  </Animated.View>;
}

const Unit = memo(function Unit({ unit, index, band, appearance, clock, start, end, warm, reduced, measure }: {
  unit: LyricUnit; index: number; band: boolean; appearance: UnitStyle; clock?: SharedValue<number>;
  start: number; end?: number; warm: boolean; reduced: boolean; measure: (index: number, width: number) => void;
}) {
  const [layout, setLayout] = useState({ width: 0, height: 0 });
  const progress = useDerivedValue(() => clock ? lyricWordProgress(start, end, clock.value) : 0);
  const raised = useSharedValue(0);
  useAnimatedReaction(() => !reduced && progress.value > 0, (singing, previous) => {
    if (singing === previous) return;
    const y = singing ? -appearance.size * 2 / 30 : 0;
    raised.value = previous === null || reduced ? y : withTiming(y, { duration: MOBILE_LYRICS_MOTION.liftMs, easing: LYRICS_EASE });
  }, [reduced, appearance.size]);
  const lift = useAnimatedStyle(() => ({ transform: [{ translateY: raised.value }] }));
  return <Animated.View style={[{ maxWidth: appearance.width, flexShrink: 0 }, lift]} onLayout={event => {
    const { width, height } = event.nativeEvent.layout;
    setLayout(previous => previous.width === width && previous.height === height ? previous : { width, height });
    measure(index, width);
  }}>
    <View style={{ opacity: clock ? .36 : 1 }}><UnitText unit={unit} band={band} appearance={appearance} glow /></View>
    {warm && layout.width > 0 && <WordLight unit={unit} band={band} appearance={appearance}
      width={layout.width} height={layout.height} progress={progress} />}
  </Animated.View>;
});

function LyricsLineComponent({ line, endMs, size, width, right, label, clock, warm, reduced, settings, onSeek }: LyricsLinePresentation) {
  const colors = useColors();
  const { furiganaEnabled, wordTimingEnabled, translationsEnabled, translationPriority, voiceLabelsEnabled } = settings;
  const units = useMemo(() => lyricUnits(line, furiganaEnabled), [line, furiganaEnabled]);
  const band = units.some(unit => unit.segments.some(segment => segment.reading));
  const appearance = useMemo(() => ({ size, width, color: colors.textPrimary, glow: rgbaFromHex(colors.textPrimary, .15) }), [size, width, colors.textPrimary]);
  const measured = useRef<number[]>([]);
  const [balancedWidth, setBalancedWidth] = useState(width);
  // The column is keyed by dimensions/settings/payload, so these measurements
  // cannot escape into another song or font layout.
  const measure = useCallback((index: number, unitWidth: number) => {
    measured.current[index] = unitWidth;
    if (units.every((_, i) => measured.current[i] > 0)) setBalancedWidth(balancedLyricWidth(measured.current, width));
  }, [units, width]);
  const translation = translationsEnabled ? getPreferredLyricsTranslation(line, translationPriority) : null;
  const align = right ? 'right' : 'left';
  return <AppPressable unstable_pressDelay={SCROLL_PRESS_DELAY} onPress={onSeek}
    accessibilityRole="button" accessibilityLabel={[voiceLabelsEnabled ? label : null, line.text, translation?.text].filter(Boolean).join('. ')}
    accessibilityHint="Seek to this lyric" style={{ minHeight: 44, paddingVertical: size * .1, justifyContent: 'center' }}>
    <View style={{ alignItems: right ? 'flex-end' : 'flex-start' }}>
      {voiceLabelsEnabled && !!label && <Text variant="mono" allowFontScaling={false} color={colors.textSecondary}
        style={{ fontSize: Math.max(10, size / 3), lineHeight: Math.max(13, size * .44), letterSpacing: size * 1.4 / 30, marginBottom: size * .2, textAlign: align }}>{label}</Text>}
      {!line.words?.length && !band
        ? <Text variant="heading" allowFontScaling={false} color={colors.textPrimary} textBreakStrategy="balanced"
          style={{ width, fontSize: size, lineHeight: size * 1.34, letterSpacing: size * -.012, textAlign: align, includeFontPadding: false,
            textShadowColor: appearance.glow, textShadowRadius: size * 8 / 30, textShadowOffset: { width: 0, height: 0 } }}>{line.text}</Text>
        : <View style={{ width: balancedWidth, flexDirection: 'row', flexWrap: 'wrap', justifyContent: right ? 'flex-end' : 'flex-start' }}>
          {units.map((unit, index) => <Unit key={index} unit={unit} index={index} band={band} appearance={appearance}
            clock={wordTimingEnabled && line.words?.length ? clock : undefined}
            start={line.words?.[index]?.timestampMs ?? 0} end={line.words ? lyricWordEndMs(line.words, index, endMs) : undefined}
            warm={warm && wordTimingEnabled && !!line.words?.length} reduced={reduced} measure={measure} />)}
        </View>}
      {!!translation && <Text variant="label" allowFontScaling={false} color={colors.textPrimary} textBreakStrategy="balanced"
        style={{ maxWidth: width, fontSize: Math.max(11, size * 16 / 30), lineHeight: Math.max(15, size * .72), marginTop: size * .2, opacity: .62, textAlign: align }}>{translation.text}</Text>}
    </View>
  </AppPressable>;
}

export const LyricsLine = memo(LyricsLineComponent, sameLyricsLinePresentation);

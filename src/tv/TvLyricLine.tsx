import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import Animated, { Easing, useAnimatedReaction, useAnimatedStyle, useDerivedValue, useSharedValue, withDelay, withTiming, type SharedValue } from 'react-native-reanimated';
import { getPreferredLyricsTranslation, type SyncedLyricsDisplayLine } from '@/lyrics/presentation';
import type { LyricsLine } from '@/lyrics/types';
import { balancedLyricWidth, lyricOpacity, lyricUnits, lyricWordProgress, type TvLyricUnit } from './playerLyricsModel';
import { TvGradientMask, TvText } from './TvPrimitives';
import { useTvTheme } from './useTvTheme';

const WIDTH = 472;
const EASE = Easing.bezier(.22, 1, .36, 1);
const TEXT_HEIGHT = 40.2;
const READING_HEIGHT = 15;
export type TvLyricsSettings = { wordTimingEnabled: boolean; furiganaEnabled: boolean; translationsEnabled: boolean; translationPriority: string[]; voiceLabelsEnabled: boolean };

/** Move a feathered viewport across static glyphs, counter-translating its
 * contents. Both transforms stay on the compositor; no glyph bitmap mask. */
function WordLight({ unit, width, band, progress, color }: { unit: TvLyricUnit; width: number; band: boolean; progress: SharedValue<number>; color: string }) {
  const sweep = useAnimatedStyle(() => ({ transform: [{ translateX: -width - 16 + progress.value * (width + 16) }] }));
  const glyph = useAnimatedStyle(() => ({ transform: [{ translateX: width + 16 - progress.value * (width + 16) }] }));
  return <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, sweep]}>
    <TvGradientMask width={width + 16} height={TEXT_HEIGHT + (band ? READING_HEIGHT : 0)} horizontal stops={[0, 0, width / (width + 16), 1]}>
      <Animated.View style={[{ width }, glyph]}><UnitText unit={unit} band={band} color={color} /></Animated.View>
    </TvGradientMask>
  </Animated.View>;
}

const UnitText = memo(function UnitText({ unit, band, color, glow = false }: { unit: TvLyricUnit; band: boolean; color: string; glow?: boolean }) {
  return <View style={{ flexDirection: 'row', paddingTop: band ? READING_HEIGHT : 0 }}>
    {unit.segments.map((segment, i) => <View key={i} style={{ flexShrink: 1 }}>
      <TvText size={30} weight="semibold" color={color} numberOfLines={1} adjustsFontSizeToFit style={{ lineHeight: TEXT_HEIGHT, letterSpacing: -.36, ...(glow ? { textShadowColor: '#eaf0ff26', textShadowRadius: 8, textShadowOffset: { width: 0, height: 0 } } : {}) }}>{segment.text}</TvText>
      {!!segment.reading && <TvText size={11.4} weight="medium" color={color} numberOfLines={1} adjustsFontSizeToFit style={{ position: 'absolute', top: -READING_HEIGHT, left: 0, right: 0, height: READING_HEIGHT, lineHeight: READING_HEIGHT, textAlign: 'center' }}>{segment.reading}</TvText>}
    </View>)}
  </View>;
});

const Unit = memo(function Unit({ unit, index, band, clock, start, end, warm, reduced, measure }: { unit: TvLyricUnit; index: number; band: boolean; clock?: SharedValue<number>; start: number; end?: number; warm: boolean; reduced: boolean; measure: (index: number, width: number) => void }) {
  const tv = useTvTheme();
  const [width, setWidth] = useState(0);
  const progress = useDerivedValue(() => {
    if (!clock) return 0;
    return lyricWordProgress(start, end, clock.value);
  });
  const raised = useSharedValue(0);
  useAnimatedReaction(() => progress.value > 0, (active, previous) => {
    if (active !== previous) raised.value = previous === null || reduced ? active ? -2 : 0 : withTiming(active ? -2 : 0, { duration: 320, easing: EASE });
  }, [reduced]);
  const lift = useAnimatedStyle(() => ({ transform: [{ translateY: raised.value }] }));
  return <Animated.View onLayout={event => { const w = event.nativeEvent.layout.width; setWidth(w); measure(index, w); }} style={[{ maxWidth: WIDTH, flexShrink: 0 }, lift]}>
    {/* Line opacity supplies emphasis. Keeping the faint glow static avoids
        rebuilding every word's native text layout at each cue boundary. */}
    <View style={{ opacity: clock ? .36 : 1 }}><UnitText unit={unit} band={band} color={tv.strong} glow /></View>
    {warm && width > 0 && <WordLight unit={unit} band={band} width={width} progress={progress} color={tv.strong} />}
  </Animated.View>;
});

const LyricText = memo(function LyricText({ line, settings, right, clock, warm, reduced }: { line: LyricsLine; settings: TvLyricsSettings; right: boolean; clock?: SharedValue<number>; warm: boolean; reduced: boolean }) {
  const tv = useTvTheme();
  const units = useMemo(() => lyricUnits(line, settings.furiganaEnabled), [line, settings.furiganaEnabled]);
  const band = units.some(unit => unit.segments.some(segment => segment.reading));
  const measured = useRef<{ units: typeof units; widths: number[] }>({ units, widths: [] });
  const [balance, setBalance] = useState<{ units: typeof units; width: number } | null>(null);
  const measure = useCallback((index: number, width: number) => {
    if (measured.current.units !== units) measured.current = { units, widths: [] };
    measured.current.widths[index] = width;
    if (units.every((_, i) => measured.current.widths[i] > 0)) {
      const next = balancedLyricWidth(measured.current.widths, WIDTH);
      setBalance(previous => previous?.units === units && previous.width === next ? previous : { units, width: next });
    }
  }, [units]);
  const translation = settings.translationsEnabled ? getPreferredLyricsTranslation(line, settings.translationPriority) : null;
  return <View style={{ alignItems: right ? 'flex-end' : 'flex-start' }}>
    {!line.words?.length && !band
      ? <TvText size={30} weight="semibold" color={tv.strong} textBreakStrategy="balanced" style={{ width: WIDTH, lineHeight: TEXT_HEIGHT, letterSpacing: -.36, textAlign: right ? 'right' : 'left', ...(clock ? { textShadowColor: '#eaf0ff26', textShadowRadius: 8, textShadowOffset: { width: 0, height: 0 } } : {}) }}>{line.text}</TvText>
      : <View style={{ width: balance?.units === units ? balance.width : WIDTH, flexDirection: 'row', flexWrap: 'wrap', justifyContent: right ? 'flex-end' : 'flex-start' }}>
        {units.map((unit, i) => <Unit key={i} unit={unit} index={i} band={band}
          clock={settings.wordTimingEnabled && line.words?.length ? clock : undefined} start={line.words?.[i]?.timestampMs ?? 0} end={line.words?.[i + 1]?.timestampMs}
          warm={warm && settings.wordTimingEnabled && !!line.words?.length} reduced={reduced} measure={measure} />)}
      </View>}
    {!!translation && <TvText size={16} weight="medium" color={tv.strong} textBreakStrategy="balanced" style={{ marginTop: 6, opacity: .62, lineHeight: 21.6, textAlign: right ? 'right' : 'left' }}>{translation.text}</TvText>}
  </View>;
});

function Gap({ clock, start, end, past }: { clock?: SharedValue<number>; start: number; end: number | null; past: boolean }) {
  const fill = useAnimatedStyle(() => ({ transform: [{ scaleX: !clock ? past ? 1 : 0 : end === null || end <= start ? 0 : Math.max(0, Math.min(1, (clock.value * 1000 - start) / (end - start))) }] }));
  return <View style={{ width: 150, height: 3, marginVertical: 18, backgroundColor: 'rgba(124,146,196,.2)', borderRadius: 2, overflow: 'hidden' }}>
    <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: '#c9d1e1', transformOrigin: 'left center' }, fill]} />
  </View>;
}

export const TvLyricLine = memo(function TvLyricLine({ item, distance, current, clock, shift, revision, reduced, right, label, settings, measure }: {
  item: SyncedLyricsDisplayLine; distance: number; current: boolean; clock?: SharedValue<number>; shift: number; revision: number; reduced: boolean; right: boolean; label: string | null; settings: TvLyricsSettings; measure: (index: number, event: LayoutChangeEvent) => void;
}) {
  const tv = useTvTheme();
  const y = useSharedValue(shift);
  // Keep native measurements/wrapping for the full song, but animate only the
  // viewport and its overscan. Offscreen lines need no per-frame native work.
  const nearby = distance >= -4 && distance <= 10;
  const previousRevision = useRef(revision);
  useEffect(() => {
    const instant = reduced || !nearby || previousRevision.current !== revision;
    previousRevision.current = revision;
    y.value = instant ? shift : withDelay(Math.max(0, Math.min(distance, 8)) * 45, withTiming(shift, { duration: 820, easing: EASE }));
  }, [y, shift, distance, revision, reduced, nearby]);
  const opacity = item.kind === 'gap' && current ? .9 : lyricOpacity(distance, current);
  const motion = useAnimatedStyle(() => ({
    opacity: withTiming(opacity, { duration: reduced || !nearby ? 0 : 520 }),
    transform: [{ translateY: y.value }, { scale: withTiming(current ? 1 : .965, { duration: reduced || !nearby ? 0 : 820, easing: EASE }) }],
  }));
  return <Animated.View renderToHardwareTextureAndroid={nearby} onLayout={event => measure(item.displayIndex, event)} style={[{ width: WIDTH, marginBottom: 26, transformOrigin: right ? 'right center' : 'left center' }, motion]}>
    {item.kind === 'gap' ? <Gap clock={clock} start={item.progressStartMs} end={item.progressEndMs} past={distance < 0} /> : <>
      {settings.voiceLabelsEnabled && !!label && <TvText mono size={10} color={tv.muted} style={{ letterSpacing: 1.4, marginBottom: 6, textAlign: right ? 'right' : 'left' }}>{label}</TvText>}
      <LyricText line={item.line} settings={settings} right={right} clock={clock} warm={distance >= -1 && distance <= 2} reduced={reduced} />
    </>}
  </Animated.View>;
});

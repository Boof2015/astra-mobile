import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import MaskedView from '@react-native-masked-view/masked-view';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withDelay, withTiming } from 'react-native-reanimated';
import { getPreferredLyricsTranslation, getSyncedLyricsGapProgress, resolveLyricsWordTiming, type SyncedLyricsDisplayLine } from '@/lyrics/presentation';
import type { LyricsLine } from '@/lyrics/types';
import { balancedLyricWidth, lyricOpacity, lyricUnits, type TvLyricUnit } from './playerLyricsModel';
import { TvText } from './TvPrimitives';
import { useTvTheme } from './useTvTheme';

const WIDTH = 472;
const EASE = Easing.bezier(.22, 1, .36, 1);
const TEXT_HEIGHT = 40.2;
const READING_HEIGHT = 15;
type Settings = { wordTimingEnabled: boolean; furiganaEnabled: boolean; translationsEnabled: boolean; translationPriority: string[]; voiceLabelsEnabled: boolean };

/** The mask is static text. Only the light behind it moves; Android can cache
 * the glyph mask instead of repainting glyphs or a software mask each frame. */
function WordLight({ unit, width, band, progress, reduced, color }: { unit: TvLyricUnit; width: number; band: boolean; progress: number; reduced: boolean; color: string }) {
  const position = useSharedValue(progress);
  useEffect(() => { position.value = withTiming(progress, { duration: reduced ? 0 : 80, easing: Easing.linear }); }, [position, progress, reduced]);
  const sweep = useAnimatedStyle(() => ({ transform: [{ translateX: -width - 16 + position.value * (width + 16) }] }));
  const mask = useMemo(() => <UnitText unit={unit} band={band} color="white" />, [unit, band]);
  return <MaskedView pointerEvents="none" androidRenderingMode="hardware" style={StyleSheet.absoluteFill} maskElement={mask}>
    <Animated.View style={[{ width: width + 16, height: TEXT_HEIGHT + (band ? READING_HEIGHT : 0), flexDirection: 'row' }, sweep]}>
      <View style={{ width, height: '100%', backgroundColor: color }} />
      <Svg width={16} height={1} viewBox="0 0 16 1" style={{ alignSelf: 'center', transform: [{ scaleY: TEXT_HEIGHT + (band ? READING_HEIGHT : 0) }] }}>
        <Defs><LinearGradient id="feather" x1="0" y1="0" x2="1" y2="0"><Stop offset="0" stopColor={color} /><Stop offset="1" stopColor={color} stopOpacity={0} /></LinearGradient></Defs>
        <Rect width={16} height={1} fill="url(#feather)" />
      </Svg>
    </Animated.View>
  </MaskedView>;
}

const UnitText = memo(function UnitText({ unit, band, color, glow = false }: { unit: TvLyricUnit; band: boolean; color: string; glow?: boolean }) {
  return <View style={{ flexDirection: 'row', paddingTop: band ? READING_HEIGHT : 0 }}>
    {unit.segments.map((segment, i) => <View key={i} style={{ flexShrink: 1 }}>
      <TvText size={30} weight="semibold" color={color} numberOfLines={1} adjustsFontSizeToFit style={{ lineHeight: TEXT_HEIGHT, letterSpacing: -.36, ...(glow ? { textShadowColor: '#eaf0ff26', textShadowRadius: 8, textShadowOffset: { width: 0, height: 0 } } : {}) }}>{segment.text}</TvText>
      {!!segment.reading && <TvText size={11.4} weight="medium" color={color} numberOfLines={1} adjustsFontSizeToFit style={{ position: 'absolute', top: -READING_HEIGHT, left: 0, right: 0, height: READING_HEIGHT, lineHeight: READING_HEIGHT, textAlign: 'center' }}>{segment.reading}</TvText>}
    </View>)}
  </View>;
});

const Unit = memo(function Unit({ unit, index, band, progress, current, reduced, measure }: { unit: TvLyricUnit; index: number; band: boolean; progress: number | null; current: boolean; reduced: boolean; measure: (index: number, width: number) => void }) {
  const tv = useTvTheme();
  const [width, setWidth] = useState(0);
  const lift = useAnimatedStyle(() => ({ transform: [{ translateY: withTiming(progress !== null && progress > 0 ? -2 : 0, { duration: reduced ? 0 : 320, easing: EASE }) }] }));
  return <Animated.View onLayout={event => { const w = event.nativeEvent.layout.width; setWidth(w); measure(index, w); }} style={[{ maxWidth: WIDTH, flexShrink: 0 }, lift]}>
    <View style={{ opacity: progress === null ? 1 : .36 }}><UnitText unit={unit} band={band} color={tv.strong} glow={current} /></View>
    {progress !== null && width > 0 && <WordLight unit={unit} band={band} width={width} progress={progress} reduced={reduced} color={tv.strong} />}
  </Animated.View>;
});

function LyricText({ line, settings, right, currentTime, reduced }: { line: LyricsLine; settings: Settings; right: boolean; currentTime: number | null; reduced: boolean }) {
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
  const timing = currentTime !== null && settings.wordTimingEnabled && line.words?.length ? resolveLyricsWordTiming(line.words, currentTime) : null;
  return <View style={{ alignItems: right ? 'flex-end' : 'flex-start' }}>
    {!line.words?.length && !band
      ? <TvText size={30} weight="semibold" color={tv.strong} textBreakStrategy="balanced" style={{ width: WIDTH, lineHeight: TEXT_HEIGHT, letterSpacing: -.36, textAlign: right ? 'right' : 'left', ...(currentTime !== null ? { textShadowColor: '#eaf0ff26', textShadowRadius: 8, textShadowOffset: { width: 0, height: 0 } } : {}) }}>{line.text}</TvText>
      : <View style={{ width: balance?.units === units ? balance.width : WIDTH, flexDirection: 'row', flexWrap: 'wrap', justifyContent: right ? 'flex-end' : 'flex-start' }}>
        {units.map((unit, i) => <Unit key={i} unit={unit} index={i} current={currentTime !== null} band={band} progress={timing?.progressByIndex[i] ?? null} reduced={reduced} measure={measure} />)}
      </View>}
    {!!translation && <TvText size={16} weight="medium" color={tv.strong} textBreakStrategy="balanced" style={{ marginTop: 6, opacity: .62, lineHeight: 21.6, textAlign: right ? 'right' : 'left' }}>{translation.text}</TvText>}
  </View>;
}

function Gap({ progress, reduced }: { progress: number; reduced: boolean }) {
  const fill = useAnimatedStyle(() => ({ transform: [{ scaleX: withTiming(progress, { duration: reduced ? 0 : 80, easing: Easing.linear }) }] }));
  return <View style={{ width: 150, height: 3, marginVertical: 18, backgroundColor: 'rgba(124,146,196,.2)', borderRadius: 2, overflow: 'hidden' }}>
    <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: '#c9d1e1', transformOrigin: 'left center' }, fill]} />
  </View>;
}

export const TvLyricLine = memo(function TvLyricLine({ item, distance, current, time, shift, revision, reduced, right, label, settings, measure }: {
  item: SyncedLyricsDisplayLine; distance: number; current: boolean; time: number | null; shift: number; revision: number; reduced: boolean; right: boolean; label: string | null; settings: Settings; measure: (index: number, event: LayoutChangeEvent) => void;
}) {
  const tv = useTvTheme();
  const y = useSharedValue(shift);
  const previousRevision = useRef(revision);
  useEffect(() => {
    const instant = reduced || previousRevision.current !== revision;
    previousRevision.current = revision;
    y.value = instant ? shift : withDelay(Math.max(0, Math.min(distance, 8)) * 45, withTiming(shift, { duration: 820, easing: EASE }));
  }, [y, shift, distance, revision, reduced]);
  const opacity = item.kind === 'gap' && current ? .9 : lyricOpacity(distance, current);
  const motion = useAnimatedStyle(() => ({
    opacity: withTiming(opacity, { duration: reduced ? 0 : 520 }),
    transform: [{ translateY: y.value }, { scale: withTiming(current ? 1 : .965, { duration: reduced ? 0 : 820, easing: EASE }) }],
  }));
  return <Animated.View onLayout={event => measure(item.displayIndex, event)} style={[{ width: WIDTH, marginBottom: 26, transformOrigin: right ? 'right center' : 'left center' }, motion]}>
    {item.kind === 'gap' ? <Gap progress={getSyncedLyricsGapProgress(item, time ?? (distance < 0 ? (item.progressEndMs ?? item.progressStartMs) / 1000 : 0)) ?? 0} reduced={reduced} /> : <>
      {settings.voiceLabelsEnabled && !!label && <TvText mono size={10} color={tv.muted} style={{ letterSpacing: 1.4, marginBottom: 6, textAlign: right ? 'right' : 'left' }}>{label}</TvText>}
      <LyricText line={item.line} settings={settings} right={right} currentTime={time} reduced={reduced} />
    </>}
  </Animated.View>;
});

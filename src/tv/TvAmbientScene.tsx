import { memo, useEffect, useRef, useState, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import Animated, { cancelAnimation, Easing, FadeIn, FadeOut, useAnimatedStyle, useSharedValue, withDelay, withRepeat, withTiming } from 'react-native-reanimated';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import { usePlayerStore } from '@/stores/playerStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { TvAtmosphere } from './TvAtmosphere';
import { TvArtwork, TvText, box } from './TvPrimitives';
import { TvPlayerHairline } from './TvPlayerWaveform';
import { AMBIENT_MOMENT_MS, ambientLayout, ambientText } from './ambientModel';
import { loadAmbientMoment, type PreparedAmbientMoment } from './ambientData';

const ink = { bg: '#080a0f', strong: '#f6f8fd', text: '#e2e8f4', caption: '#c9d1e1', muted: '#8a98b8', accent: '#a9c0ff' };
const ease = Easing.bezier(.22, 1, .36, 1);
const captionEnter = FadeIn.duration(650).easing(Easing.inOut(Easing.quad));
const captionExit = FadeOut.duration(650).easing(Easing.inOut(Easing.quad));
type Moment = { key: number; item: PreparedAmbientMoment; delay: number; leaving: boolean };

export function TvAmbientScene({ first, visible, dismiss }: { first: PreparedAmbientMoment; visible: boolean; dismiss: () => boolean }) {
  const [moments, setMoments] = useState<Moment[]>([{ key: 0, item: first, delay: 1500, leaving: false }]);
  const [light, setLight] = useState(first.uri);
  const sequence = useRef(0);
  const seen = useRef([first.album.identity_key]);
  const active = useRef(visible);
  const opacity = useSharedValue(0);
  const caption = useSharedValue(0);
  const fade = useAnimatedStyle(() => ({ opacity: opacity.value }));
  const captionStyle = useAnimatedStyle(() => ({ opacity: caption.value }));
  useEffect(() => {
    active.current = visible;
    opacity.set(withTiming(visible ? 1 : 0, { duration: visible ? 2200 : 320, easing: Easing.bezier(.4, 0, .2, 1) }));
    caption.set(visible ? withDelay(1600, withTiming(1, { duration: 1200 })) : withTiming(0, { duration: 320 }));
    return () => { active.current = false; cancelAnimation(opacity); cancelAnimation(caption); };
  }, [visible, opacity, caption]);
  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    let remove: ReturnType<typeof setTimeout> | undefined;
    const advance = async () => {
      const path = usePlayerStore.getState().currentTrack?.path;
      let next: PreparedAmbientMoment | null;
      try { next = await loadAmbientMoment(seen.current); } catch { if (!cancelled) timer = setTimeout(advance, AMBIENT_MOMENT_MS); return; }
      if (cancelled || !active.current) { next?.image?.release(); return; }
      if (path !== usePlayerStore.getState().currentTrack?.path) {
        next?.image?.release(); timer = setTimeout(advance, 1000); return;
      }
      if (!next) { dismiss(); return; }
      if (next.reset) seen.current = [];
      seen.current.push(next.album.identity_key);
      const key = ++sequence.current;
      setLight(next.uri);
      setMoments(previous => [...previous.map(moment => ({ ...moment, leaving: true })), { key, item: next, delay: 750, leaving: false }]);
      remove = setTimeout(() => setMoments(previous => previous.filter(moment => !moment.leaving)), 1500);
      timer = setTimeout(advance, AMBIENT_MOMENT_MS);
    };
    timer = setTimeout(advance, AMBIENT_MOMENT_MS);
    return () => { cancelled = true; clearTimeout(timer); if (remove) clearTimeout(remove); };
  }, [visible, dismiss]);
  return <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: ink.bg, overflow: 'hidden' }, fade]}>
    <TvAtmosphere uri={light} strength={.85} player dark active={visible} playing={visible} transitionMs={1600} settleMs={0} />
    <Svg width={960} height={540} style={StyleSheet.absoluteFill} pointerEvents="none">
      <Defs><LinearGradient id="ambientScrim" x1="0" y1="0" x2="0" y2="1"><Stop offset={0} stopColor="#04060a" stopOpacity={.1} /><Stop offset={.4} stopColor="#04060a" stopOpacity={0} /><Stop offset={1} stopColor="#04060a" stopOpacity={.45} /></LinearGradient></Defs>
      <Rect width={960} height={540} fill="url(#ambientScrim)" />
    </Svg>
    {moments.map(moment => <AmbientAlbum key={moment.key} moment={moment} />)}
    <Animated.View style={[StyleSheet.absoluteFill, captionStyle]}><AmbientCaption active={visible} /></Animated.View>
  </Animated.View>;
}

function Piece({ delay, leaving, children, style }: { delay: number; leaving: boolean; children: ReactNode; style?: object }) {
  const opacity = useSharedValue(0), y = useSharedValue(10);
  useEffect(() => {
    opacity.value = leaving ? withTiming(0, { duration: 600 }) : withDelay(delay, withTiming(1, { duration: 900, easing: Easing.out(Easing.cubic) }));
    y.value = leaving ? withTiming(-6, { duration: 600 }) : withDelay(delay, withTiming(0, { duration: 1100, easing: ease }));
    return () => { cancelAnimation(opacity); cancelAnimation(y); };
  }, [leaving, delay, opacity, y]);
  const animated = useAnimatedStyle(() => ({ opacity: opacity.value, transform: [{ translateY: y.value }] }));
  return <Animated.View style={[style, animated]}>{children}</Animated.View>;
}

const AmbientAlbum = memo(function AmbientAlbum({ moment }: { moment: Moment }) {
  const { item, delay, leaving, key } = moment;
  const history = useSettingsStore(s => s.listeningHistoryEnabled);
  const text = ambientText(item, history);
  const layout = ambientLayout(key, item.album.album);
  // Tight leading needs extra drawing room for Android's first/last-line glyphs.
  // Cancel that padding in layout to preserve the reference's spacing and centering.
  const titleBleed = Math.ceil(layout.titleSize * .15);
  const alpha = useSharedValue(0), scale = useSharedValue(.965), drift = useSharedValue(0);
  useEffect(() => {
    alpha.value = withDelay(delay, withTiming(1, { duration: 1500, easing: Easing.out(Easing.cubic) }));
    scale.value = withDelay(delay, withTiming(1, { duration: 2200, easing: ease }));
    drift.value = withDelay(delay, withTiming(1, { duration: AMBIENT_MOMENT_MS, easing: Easing.linear }));
    return () => { cancelAnimation(alpha); cancelAnimation(scale); cancelAnimation(drift); item.image?.release(); };
  }, [item.image, delay, alpha, scale, drift]);
  useEffect(() => { if (leaving) alpha.set(withTiming(0, { duration: 900 })); }, [leaving, alpha]);
  const artStyle = useAnimatedStyle(() => ({ opacity: alpha.value, transform: [{ translateX: layout.driftX * drift.value }, { translateY: -12 * drift.value }, { scale: scale.value }] }));
  return <View style={StyleSheet.absoluteFill}>
    <Animated.View style={[box(layout.artX, layout.y, 300, 300), { borderRadius: 14, backgroundColor: '#111725', boxShadow: '0px 34px 80px rgba(0,0,0,0.6)' }, artStyle]}>
      {item.image ? <Image source={item.image} style={[StyleSheet.absoluteFill, { borderRadius: 14 }]} contentFit="cover" />
        : <View style={[StyleSheet.absoluteFill, { alignItems: 'center', justifyContent: 'center' }]}><Ionicons name="musical-notes" size={80} color={ink.muted} /></View>}
      <View style={[StyleSheet.absoluteFill, { borderRadius: 14, borderWidth: 1, borderColor: '#ffffff1a' }]} />
    </Animated.View>
    <Piece delay={delay + 600} leaving={leaving} style={box(layout.artX, layout.y - 28, 330)}>
      <TvText mono size={11} color={ink.caption} numberOfLines={1} style={{ letterSpacing: 1.98 }}>{text.label.toLocaleUpperCase()}</TvText>
    </Piece>
    <View style={[box(layout.textX, layout.y, 410, 300), { justifyContent: 'center' }]}>
      <Piece delay={delay + 820} leaving={leaving}><TvText mono size={13} color={ink.text} numberOfLines={1} style={{ letterSpacing: 2.08 }}>{item.album.artist.toLocaleUpperCase()}</TvText></Piece>
      <Piece delay={delay + 960} leaving={leaving} style={{ marginTop: 8 }}><TvText size={layout.titleSize} weight="semibold" color={ink.strong} numberOfLines={2} style={{ lineHeight: layout.titleSize * 1.04, letterSpacing: -layout.titleSize * .045, paddingVertical: titleBleed, marginVertical: -titleBleed }}>{item.album.album}</TvText></Piece>
      <Piece delay={delay + 1180} leaving={leaving} style={{ marginTop: 18 }}><TvText size={16} color={ink.caption} numberOfLines={1} style={{ lineHeight: 23.2 }}>{text.context}</TvText></Piece>
    </View>
  </View>;
});

const AmbientCaption = memo(function AmbientCaption({ active }: { active: boolean }) {
  const track = usePlayerStore(s => s.currentTrack);
  const drift = useSharedValue(0);
  const bars = useSharedValue(0);
  useEffect(() => {
    if (active) {
      drift.value = withRepeat(withTiming(1, { duration: 60_000, easing: Easing.inOut(Easing.sin) }), -1, true);
      bars.value = withRepeat(withTiming(1, { duration: 1300, easing: Easing.inOut(Easing.sin) }), -1, true);
    }
    return () => { cancelAnimation(drift); cancelAnimation(bars); };
  }, [active, drift, bars]);
  const style = useAnimatedStyle(() => ({ transform: [{ translateX: drift.value * 6 }, { translateY: drift.value * -4 }] }));
  const barA = useAnimatedStyle(() => ({ transform: [{ scaleY: .35 + bars.value * .65 }] }));
  const barB = useAnimatedStyle(() => ({ transform: [{ scaleY: 1 - bars.value * .65 }] }));
  if (!track) return null;
  return <>
    <Animated.View style={[box(96, 466, 768, 36), style]}>
      {/* Retain the outgoing native row during its fade; rapid skips never queue stale songs. */}
      <Animated.View key={track.path} entering={captionEnter} exiting={captionExit}
        style={[StyleSheet.absoluteFill, { flexDirection: 'row', alignItems: 'center', gap: 12 }]}>
        <TvArtwork uri={track.artworkData} size={36} />
        <View style={{ maxWidth: 670 }}><TvText mono size={9.5} color={ink.accent} style={{ letterSpacing: 1.52, marginBottom: 5, lineHeight: 10 }}>NOW PLAYING</TvText>
          <TvText size={14} weight="semibold" color={ink.strong} numberOfLines={1}>{track.title}<TvText size={14} color={ink.muted}> · {track.artist}</TvText></TvText></View>
        <View style={{ flexDirection: 'row', gap: 2.5, alignItems: 'flex-end', height: 13, marginLeft: 6 }}>
          {[7, 13, 9].map((height, i) => <Animated.View key={i} style={[{ width: 2.5, height, borderRadius: 1, backgroundColor: ink.accent, transformOrigin: 'bottom' }, i === 1 ? barB : barA]} />)}
        </View>
      </Animated.View>
    </Animated.View>
    <TvPlayerHairline path={track.path} active={active} color={ink.strong} />
  </>;
});

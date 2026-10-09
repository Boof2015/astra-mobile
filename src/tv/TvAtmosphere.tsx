import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';
import Svg, { Defs, RadialGradient, Rect, Stop } from 'react-native-svg';
import Reanimated, { useAnimatedStyle, useFrameCallback, useReducedMotion, useSharedValue, withTiming, type SharedValue } from 'react-native-reanimated';
import { extractArtworkColors } from '@/theme/artworkAccent';
import { ArtworkAccentCache } from '@/theme/artworkAccentCache';
import { rgbToOklab } from '@/theme/adaptiveAccent';
import { hexToRgb } from '@/theme/colorUtils';
import { oklchToHex } from '@/theme/artworkField';
import { useTvTheme } from './useTvTheme';

const cache = new ArtworkAccentCache<string[]>(128);
const falloff = [[0, 1], [.18, .78], [.36, .5], [.56, .25], [.76, .08], [1, 0]];

// Android SVG rasterizes on the UI thread. These broad, soft gradients need
// only a quarter-resolution surface; scaling it preserves their appearance
// without allocating and painting a full 4K bitmap for every layer.
const Field = memo(function Field({ colors }: { colors: string[] }) {
  return <Svg width={240} height={135} viewBox="0 0 960 540"
    style={{ position: 'absolute', left: 360, top: 202.5, transform: [{ scale: 4 }] }}>
    <Defs>{colors.map((color, i) => <RadialGradient key={i} id={`field${i}`} cx="50%" cy="50%" rx="50%" ry="50%">
      {falloff.map(([offset, opacity]) => <Stop key={offset} offset={offset} stopColor={color} stopOpacity={opacity} />)}
    </RadialGradient>)}</Defs>
    <Rect width={960} height={540} fill={colors[1]} opacity={0.25} />
    {[[330, -325, 1150, 1060], [-350, -270, 1280, 940], [240, 30, 1180, 980]]
      .map(([x, y, width, height], i) => <Rect key={i} x={x} y={y} width={width} height={height} fill={`url(#field${i})`} />)}
  </Svg>;
});

const playerBlobs = [
  { x: 18, y: 32, rx: 70, ry: 105, dx: 100, dy: 64, tx: 37, ty: 47, seed: 0 },
  { x: 86, y: 18, rx: 72, ry: 92, dx: 132, dy: 78, tx: 43, ty: 59, seed: 2.1 },
  { x: 58, y: 112, rx: 90, ry: 70, dx: 112, dy: 66, tx: 53, ty: 41, seed: 4.2 },
];

// Each color is rasterized once, then moved independently by the compositor.
// Overscan exceeds the largest orbit so a moving bitmap never reveals an edge.
// Keep the low-resolution SVGs static: animating gradient props would repaint
// their Android bitmaps every frame, especially expensive on a 4K TV.
const PlayerBlob = memo(function PlayerBlob({ color, index, phase }: { color: string; index: number; phase: SharedValue<number> }) {
  const blob = playerBlobs[index];
  const motion = useAnimatedStyle(() => ({ transform: [
    { translateX: Math.sin(phase.value * 2 * Math.PI / blob.tx + blob.seed) * blob.dx },
    { translateY: Math.cos(phase.value * 2 * Math.PI / blob.ty + blob.seed) * blob.dy },
  ] }));
  return <Reanimated.View style={[StyleSheet.absoluteFill, motion]}>
    <Svg width={320} height={185} viewBox="-160 -100 1280 740"
      style={{ position: 'absolute', left: -160, top: -100, transformOrigin: 'top left', transform: [{ scale: 4 }] }}>
      <Defs><RadialGradient id="blob" cx="50%" cy="50%" rx="50%" ry="50%">
        {falloff.map(([offset, opacity]) => <Stop key={offset} offset={offset} stopColor={color} stopOpacity={opacity} />)}
      </RadialGradient></Defs>
      <Rect x={(blob.x - blob.rx) * 9.6} y={(blob.y - blob.ry) * 5.4} width={blob.rx * 19.2} height={blob.ry * 10.8} fill="url(#blob)" />
    </Svg>
  </Reanimated.View>;
});

const PlayerField = memo(function PlayerField({ colors, phase }: { colors: string[]; phase: SharedValue<number> }) {
  return <View style={StyleSheet.absoluteFill}>
    <View style={[StyleSheet.absoluteFill, { backgroundColor: colors[1], opacity: .25 }]} />
    {colors.map((color, index) => <PlayerBlob key={index} color={color} index={index} phase={phase} />)}
  </View>;
});

export const TvAtmosphere = memo(function TvAtmosphere({ uri, strength = .3, player = false, fadeIn = false, active = false, playing = false }: { uri: string | null; strength?: number; player?: boolean; fadeIn?: boolean; active?: boolean; playing?: boolean }) {
  const tv = useTvTheme();
  const neutral = useMemo(() => {
    const { r, g, b } = hexToRgb(tv.accent); const lab = rgbToOklab(r, g, b);
    const hue = Math.atan2(lab.b, lab.a) * 180 / Math.PI;
    return (tv.dark ? [.3, .27, .33] : [.87, .9, .84]).map((l, i) => oklchToHex(l, .035, hue + [0, 14, -12][i]));
  }, [tv.accent, tv.dark]);
  const reduced = useReducedMotion();
  const phase = useSharedValue(0);
  const speed = useSharedValue(0);
  const pendingMs = useSharedValue(0);
  useEffect(() => {
    speed.value = withTiming(playing ? 1 : 0, { duration: 900 });
  }, [playing, speed]);
  const drift = useFrameCallback(frame => {
    if (speed.value === 0) return;
    pendingMs.value += frame.timeSincePreviousFrame ?? 0;
    if (pendingMs.value < 33) return;
    // Ignore long gaps on resume; pause settles in place without resetting the
    // orbit, and both palette layers always share the same position.
    phase.value += Math.min(pendingMs.value, 64) / 1000 * speed.value;
    pendingMs.value = 0;
  }, false);
  useEffect(() => {
    pendingMs.value = 0;
    // The player supplies its live accessibility/foreground state; the
    // useReducedMotion snapshot alone would not resume after a setting change.
    drift.setActive(player && active);
    return () => drift.setActive(false);
  }, [player, active, drift, pendingMs]);
  const [layers, setLayers] = useState<[string[], string[]]>([neutral, neutral]);
  const [front, setFront] = useState(0);
  const frontRef = useRef(0);
  const [opacity] = useState(() => new Animated.Value(0));
  const [reveal] = useState(() => new Animated.Value(fadeIn ? 0 : 1));
  useEffect(() => {
    Animated.timing(reveal, { toValue: 1, duration: reduced ? 0 : 450, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
    return () => reveal.stopAnimation();
  }, [reveal, reduced]);
  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(() => {
      void (async () => {
        let colors = neutral;
        if (uri) {
          const key = `${tv.dark}:${uri}`;
          const hit = cache.get(key);
          if (hit.found) colors = hit.value ?? neutral;
          else {
            const result = await extractArtworkColors(uri, null, true);
            if (result?.field && !result.field.neutral) colors = result.field.colors.map((hex, i) => {
              const { r, g, b } = hexToRgb(hex);
              const lab = rgbToOklab(r, g, b);
              return oklchToHex((tv.dark ? [.42, .37, .46] : [.83, .88, .8])[i], Math.min(.13, Math.hypot(lab.a, lab.b) * .85 / .95), Math.atan2(lab.b, lab.a) * 180 / Math.PI);
            });
            cache.set(key, colors);
          }
        }
        if (cancelled) return;
        const next = 1 - frontRef.current;
        setLayers(previous => next === 0 ? [colors, previous[1]] : [previous[0], colors]);
        frontRef.current = next; setFront(next);
      })();
    }, 280);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [uri, neutral, tv.dark]);
  useEffect(() => {
    Animated.timing(opacity, { toValue: front, duration: reduced ? 0 : 450, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
    return () => opacity.stopAnimation();
  }, [front, opacity, reduced]);
  return <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { opacity: reveal.interpolate({ inputRange: [0, 1], outputRange: [0, strength] }) }]}>
    <Animated.View style={[StyleSheet.absoluteFill, { opacity: opacity.interpolate({ inputRange: [0, 1], outputRange: [1, 0] }) }]}>{player ? <PlayerField colors={layers[0]} phase={phase} /> : <Field colors={layers[0]} />}</Animated.View>
    <Animated.View style={[StyleSheet.absoluteFill, { opacity }]}>{player ? <PlayerField colors={layers[1]} phase={phase} /> : <Field colors={layers[1]} />}</Animated.View>
  </Animated.View>;
});

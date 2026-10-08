import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing, StyleSheet } from 'react-native';
import Svg, { Defs, RadialGradient, Rect, Stop } from 'react-native-svg';
import { useReducedMotion } from 'react-native-reanimated';
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
const Field = memo(function Field({ colors, player }: { colors: string[]; player: boolean }) {
  return <Svg width={240} height={135} viewBox="0 0 960 540"
    style={{ position: 'absolute', left: 360, top: 202.5, transform: [{ scale: 4 }] }}>
    <Defs>{colors.map((color, i) => <RadialGradient key={i} id={`field${i}`} cx="50%" cy="50%" rx="50%" ry="50%">
      {falloff.map(([offset, opacity]) => <Stop key={offset} offset={offset} stopColor={color} stopOpacity={opacity} />)}
    </RadialGradient>)}</Defs>
    <Rect width={960} height={540} fill={colors[1]} opacity={0.25} />
    {(player ? [[18, 32, 70, 105], [86, 18, 72, 92], [58, 112, 90, 70]].map(([x, y, rx, ry]) => [(x - rx) * 9.6, (y - ry) * 5.4, rx * 19.2, ry * 10.8])
      : [[330, -325, 1150, 1060], [-350, -270, 1280, 940], [240, 30, 1180, 980]])
      .map(([x, y, width, height], i) => <Rect key={i} x={x} y={y} width={width} height={height} fill={`url(#field${i})`} />)}
  </Svg>;
});

export const TvAtmosphere = memo(function TvAtmosphere({ uri, strength = .3, player = false, fadeIn = false }: { uri: string | null; strength?: number; player?: boolean; fadeIn?: boolean }) {
  const tv = useTvTheme();
  const neutral = useMemo(() => {
    const { r, g, b } = hexToRgb(tv.accent); const lab = rgbToOklab(r, g, b);
    const hue = Math.atan2(lab.b, lab.a) * 180 / Math.PI;
    return (tv.dark ? [.3, .27, .33] : [.87, .9, .84]).map((l, i) => oklchToHex(l, .035, hue + [0, 14, -12][i]));
  }, [tv.accent, tv.dark]);
  const reduced = useReducedMotion();
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
    <Animated.View style={[StyleSheet.absoluteFill, { opacity: opacity.interpolate({ inputRange: [0, 1], outputRange: [1, 0] }) }]}><Field colors={layers[0]} player={player} /></Animated.View>
    <Animated.View style={[StyleSheet.absoluteFill, { opacity }]}><Field colors={layers[1]} player={player} /></Animated.View>
  </Animated.View>;
});

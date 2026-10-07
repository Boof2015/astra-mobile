import { useEffect, useMemo, useRef, useState } from 'react';
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

function Field({ colors }: { colors: string[] }) {
  return <Svg width={960} height={540}>
    <Defs>{colors.map((color, i) => <RadialGradient key={i} id={`field${i}`} cx="50%" cy="50%" rx="50%" ry="50%">
      {falloff.map(([offset, opacity]) => <Stop key={offset} offset={offset} stopColor={color} stopOpacity={opacity} />)}
    </RadialGradient>)}</Defs>
    <Rect width={960} height={540} fill={colors[1]} opacity={0.25} />
    <Rect x={330} y={-325} width={1150} height={1060} fill="url(#field0)" />
    <Rect x={-350} y={-270} width={1280} height={940} fill="url(#field1)" />
    <Rect x={240} y={30} width={1180} height={980} fill="url(#field2)" />
  </Svg>;
}

export function TvAtmosphere({ uri, strength = .3 }: { uri: string | null; strength?: number }) {
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
  return <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { opacity: strength }]}>
    <Animated.View style={[StyleSheet.absoluteFill, { opacity: opacity.interpolate({ inputRange: [0, 1], outputRange: [1, 0] }) }]}><Field colors={layers[0]} /></Animated.View>
    <Animated.View style={[StyleSheet.absoluteFill, { opacity }]}><Field colors={layers[1]} /></Animated.View>
  </Animated.View>;
}

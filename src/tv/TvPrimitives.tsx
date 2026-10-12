import { useTvTheme } from './useTvTheme';
import { useWindowDimensions, View, Text, StyleSheet, Platform, type ViewProps, type TextProps, type StyleProp, type ViewStyle } from 'react-native';
import { requireNativeViewManager } from 'expo-modules-core';
import { Image } from 'expo-image';
import { useMemo, type ReactNode } from 'react';
import MaskedView from '@react-native-masked-view/masked-view';
import { Ionicons } from '@expo/vector-icons';
import Animated, { Easing, useAnimatedStyle, useReducedMotion, withTiming } from 'react-native-reanimated';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import { fonts } from '@/theme/typography';

const NativeViewport = Platform.OS === 'android' ? requireNativeViewManager<ViewProps & { horizontal: boolean; maskStops: number[] }>('AstraTv') : null;

export const box = (left: number, top: number, width: number, height?: number): Pick<ViewStyle, 'position' | 'left' | 'top' | 'width' | 'height'> => ({ position: 'absolute', left, top, width, ...(height === undefined ? {} : { height }) });

export function TvFrame({ children }: { children: ReactNode }) {
  const tv = useTvTheme();
  const { width, height } = useWindowDimensions();
  const scale = Math.min(width / 960, height / 540);
  return <View style={{ flex: 1, backgroundColor: tv.bg }}><View style={{ position: 'absolute', width: 960, height: 540,
    left: (width - 960) / 2, top: (height - 540) / 2, transform: [{ scale }], overflow: 'hidden' }}>{children}</View></View>;
}

export function TvText({ size = 13, color, weight = 'regular', mono = false, style, ...props }: TextProps & {
  size?: number; color?: string; weight?: keyof typeof fonts.sans; mono?: boolean;
}) {
  const tv = useTvTheme();
  // Custom Latin fonts on Android do not reliably fall back to CJK glyphs.
  const text = (Array.isArray(props.children) ? props.children : [props.children]).filter(value => typeof value === 'string' || typeof value === 'number').join('');
  const fallback = /[^\u0000-\u024F\u0370-\u03FF\u0400-\u04FF\u2000-\u206F\u20A0-\u20CF\u2100-\u214F]/.test(text);
  return <Text {...props} allowFontScaling={false} style={[{ fontFamily: fallback ? undefined : mono ? fonts.mono.regular : fonts.sans[weight], fontWeight: fallback ? weight === 'bold' ? '700' : weight === 'semibold' ? '600' : weight === 'medium' ? '500' : '400' : undefined, fontSize: size, lineHeight: Math.ceil(size * 1.3), color: color ?? tv.text, includeFontPadding: false }, style]} />;
}

export function TvArtwork({ uri, size, style }: { uri: string | null | undefined; size: number; style?: StyleProp<ViewStyle> }) {
  const tv = useTvTheme();
  return <View style={[{ width: size, height: size, borderRadius: 6, overflow: 'hidden', backgroundColor: tv.surface, alignItems: 'center', justifyContent: 'center' }, style]}>
    {uri ? <Image source={{ uri }} recyclingKey={uri} style={StyleSheet.absoluteFill} contentFit="cover" cachePolicy="memory-disk" allowDownscaling /> : <Ionicons name="musical-notes" size={size * 0.3} color={tv.faint} />}
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, { borderRadius: 6, borderWidth: 1, borderColor: 'rgba(255,255,255,.08)' }]} />
  </View>;
}

export function TvMotion({ x = 0, y = 0, instant = false, style, children }: { x?: number; y?: number; instant?: boolean; style?: StyleProp<ViewStyle>; children: ReactNode }) {
  const reduced = useReducedMotion();
  const animated = useAnimatedStyle(() => ({ transform: [
    { translateX: withTiming(x, { duration: reduced || instant ? 0 : 240, easing: Easing.out(Easing.cubic) }) },
    { translateY: withTiming(y, { duration: reduced || instant ? 0 : 240, easing: Easing.out(Easing.cubic) }) },
  ] }));
  return <Animated.View style={[style, animated]}>{children}</Animated.View>;
}

/** Fade through to the atmosphere. Android records a gradient into the GPU
 * layer instead of rasterizing a full-viewport mask on the main thread. */
export function TvViewport({ width, height, topFade = 14, bottomFade = 46, shelf = false, style, children }: {
  width: number; height: number; topFade?: number; bottomFade?: number; shelf?: boolean;
  style?: StyleProp<ViewStyle>; children: ReactNode;
}) {
  return <TvGradientMask width={width} height={height} horizontal={shelf}
    stops={shelf ? [33 / width, 43 / width, 1, 1] : [0, topFade / height, (height - bottomFade) / height, 1]} style={style}>{children}</TvGradientMask>;
}

export function TvGradientMask({ width, height, horizontal = false, stops, style, children }: {
  width: number; height: number; horizontal?: boolean; stops: [number, number, number, number]; style?: StyleProp<ViewStyle>; children: ReactNode;
}) {
  const [start, startOpaque, endOpaque, end] = stops;
  // The fade varies on just one axis. Rasterize a thin strip and stretch its
  // uniform axis on the fallback renderer. Android needs no bitmap at all.
  const mask = useMemo(() => <View style={{ width, height }}><Svg
    width={horizontal ? width : 1} height={horizontal ? 1 : height}
    viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none"
    style={{ position: 'absolute', left: horizontal ? 0 : (width - 1) / 2, top: horizontal ? (height - 1) / 2 : 0,
      transform: [{ scaleX: horizontal ? 1 : width }, { scaleY: horizontal ? height : 1 }] }}>
    <Defs><LinearGradient id="fade" x1="0" y1="0" x2={horizontal ? '1' : '0'} y2={horizontal ? '0' : '1'}>
      {[[start, 0], [startOpaque, 1], [endOpaque, 1], [end, 0]].map(([offset, opacity], i) => <Stop key={i} offset={offset} stopColor="white" stopOpacity={opacity} />)}
    </LinearGradient></Defs><Rect width={width} height={height} fill="url(#fade)" />
  </Svg></View>, [width, height, horizontal, start, startOpaque, endOpaque, end]);
  // React applies its layer props after native initialization. Keep the mask
  // isolated so DST_IN fades the children, never the artwork behind them.
  if (NativeViewport) return <NativeViewport renderToHardwareTextureAndroid horizontal={horizontal} maskStops={stops}
    style={[{ width, height, overflow: 'hidden' }, style]}>{children}</NativeViewport>;
  return <MaskedView androidRenderingMode="hardware" maskElement={mask} style={[{ width, height, overflow: 'hidden' }, style]}>{children}</MaskedView>;
}

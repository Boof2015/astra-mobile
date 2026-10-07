import { useWindowDimensions, View, Text, StyleSheet, type TextProps, type StyleProp, type ViewStyle } from 'react-native';
import { Image } from 'expo-image';
import { useMemo, type ReactNode } from 'react';
import MaskedView from '@react-native-masked-view/masked-view';
import { Ionicons } from '@expo/vector-icons';
import Animated, { Easing, useAnimatedStyle, useReducedMotion, withTiming } from 'react-native-reanimated';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import { fonts } from '@/theme/typography';

export const tv = { bg: '#080a0f', text: '#e2e8f4', strong: '#f6f8fd', muted: '#8a98b8', faint: '#52607f', caption: '#c9d1e1', accent: '#a9c0ff', fill: 'rgba(124,146,196,.17)', border: 'rgba(124,146,196,.16)' };
export const box = (left: number, top: number, width: number, height?: number): Pick<ViewStyle, 'position' | 'left' | 'top' | 'width' | 'height'> => ({ position: 'absolute', left, top, width, ...(height === undefined ? {} : { height }) });

export function TvFrame({ children }: { children: ReactNode }) {
  const { width, height } = useWindowDimensions();
  const scale = Math.min(width / 960, height / 540);
  return <View style={{ flex: 1, backgroundColor: tv.bg }}><View style={{ position: 'absolute', width: 960, height: 540,
    left: (width - 960) / 2, top: (height - 540) / 2, transform: [{ scale }], overflow: 'hidden' }}>{children}</View></View>;
}

export function TvText({ size = 13, color = tv.text, weight = 'regular', mono = false, style, ...props }: TextProps & {
  size?: number; color?: string; weight?: keyof typeof fonts.sans; mono?: boolean;
}) {
  return <Text {...props} allowFontScaling={false} style={[{ fontFamily: mono ? fonts.mono.regular : fonts.sans[weight], fontSize: size, lineHeight: Math.ceil(size * 1.3), color, includeFontPadding: false }, style]} />;
}

export function TvArtwork({ uri, size, style }: { uri: string | null | undefined; size: number; style?: StyleProp<ViewStyle> }) {
  return <View style={[{ width: size, height: size, borderRadius: 6, overflow: 'hidden', backgroundColor: '#151b29', alignItems: 'center', justifyContent: 'center' }, style]}>
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

/** A static alpha mask fades the content without painting over the atmosphere.
 * Only its children move, so Android can retain the hardware-rendered mask. */
export function TvViewport({ width, height, topFade = 14, bottomFade = 46, shelf = false, style, children }: {
  width: number; height: number; topFade?: number; bottomFade?: number; shelf?: boolean;
  style?: StyleProp<ViewStyle>; children: ReactNode;
}) {
  const mask = useMemo(() => <Svg width={width} height={height}>
    <Defs><LinearGradient id="fade" x1="0" y1="0" x2={shelf ? '1' : '0'} y2={shelf ? '0' : '1'}>
      {(shelf ? [[33 / width, 0], [43 / width, 1]] : [
        [0, topFade ? 0 : 1], [topFade / height, 1],
        [(height - bottomFade) / height, 1], [1, bottomFade ? 0 : 1],
      ]).map(([offset, opacity], i) => <Stop key={i} offset={offset} stopColor="white" stopOpacity={opacity} />)}
    </LinearGradient></Defs><Rect width={width} height={height} fill="url(#fade)" />
  </Svg>, [width, height, topFade, bottomFade, shelf]);
  return <MaskedView androidRenderingMode="hardware" maskElement={mask} style={[{ width, height, overflow: 'hidden' }, style]}>{children}</MaskedView>;
}

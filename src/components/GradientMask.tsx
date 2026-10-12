import { useMemo, type ReactNode } from 'react';
import { Platform, View, type ViewProps, type StyleProp, type ViewStyle } from 'react-native';
import { requireNativeViewManager } from 'expo-modules-core';
import MaskedView from '@react-native-masked-view/masked-view';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';

// The existing AstraTv viewport is available on phones too; it has no TV-mode gate.
const NativeViewport = Platform.OS === 'android' ? requireNativeViewManager<ViewProps & { horizontal: boolean; maskStops: number[] }>('AstraTv') : null;

export function GradientMask({ width, height, horizontal = false, stops, style, children }: {
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

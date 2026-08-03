import { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import { Canvas, Fill, LinearGradient, vec } from '@shopify/react-native-skia';
import { type TopFadeBand } from '@/components/topFadeMath';
import { useColors } from '@/theme/themed';

/**
 * The gradient that lands scrolling content into the status bar.
 *
 * The mirror of `MiniPlayerScrim` at the other end of the screen, and it has
 * the same job: soften the seam where content runs into chrome. On a screen
 * that bleeds under the status bar the scroll frame reaches y=0, so a heading
 * riding up is clipped mid-glyph against the top of the window. This washes it
 * to the screen background over the strip instead, so it ends rather than
 * stops.
 *
 * Nothing here can affect layout — it is absolutely positioned and
 * `pointerEvents="none"`. On a screen already sitting on `bgPrimary` with
 * nothing scrolled up there it is invisible, which is the intended resting
 * state: this should be doing its work without being noticed.
 *
 * The ramp itself lives in `topFadeMath` — it depends on the device's status
 * bar height, so it is worth testing away from React.
 */

function withAlpha(hex: string, alpha: number): string {
  return `${hex}${Math.round(alpha * 255).toString(16).padStart(2, '0')}`;
}

export function TopFadeScrim({ band }: { band: TopFadeBand }) {
  const colors = useColors();

  // `bgPrimary` is guaranteed 6-digit hex by the palette invariant, so the
  // 8-digit alpha suffix is safe (same idiom as MiniPlayerScrim).
  const gradient = useMemo(() => ({
    colors: band.stops.map((stop) => withAlpha(colors.bgPrimary, stop.alpha)),
    positions: band.stops.map((stop) => stop.at),
  }), [band, colors.bgPrimary]);

  return (
    <View pointerEvents="none" style={[styles.band, { height: band.height }]}>
      <Canvas style={StyleSheet.absoluteFill}>
        <Fill>
          <LinearGradient
            start={vec(0, 0)}
            end={vec(0, band.height)}
            colors={gradient.colors}
            positions={gradient.positions}
          />
        </Fill>
      </Canvas>
    </View>
  );
}

const styles = StyleSheet.create({
  band: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
  },
});

export default TopFadeScrim;

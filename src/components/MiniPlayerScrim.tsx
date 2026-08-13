import { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import { Canvas, Fill, LinearGradient, vec } from '@shopify/react-native-skia';
import { layout } from '@/theme';
import { useColors } from '@/theme/themed';

/**
 * The gradient that lands the mini-player pill into the tab bar.
 *
 * By default it occupies exactly the pill's float box: transparent at the
 * pill's top edge, reaching `MAX_ALPHA` where it meets the chrome. A screen
 * that owns additional floating controls may pass a taller height so the same
 * dissolve begins above that real chrome stack.
 *
 * The first global attempt reached ~96dp further up every screen merely to dim
 * the list before it got near the pill. That read as a deliberate band. A
 * taller Library band is different: its command bar genuinely occupies that
 * space, and the extended fade removes the hard list cutoff behind it.
 *
 * The pill's own separation from content comes from its fill and its rim, not
 * from here.
 *
 * On screens whose background already is `bgPrimary` (Home, Settings) this is a
 * no-op. It only shows up where content is bright, which is the only place the
 * problem exists.
 */

/**
 * Strength where it meets the tab bar. Deliberately short of 1 — a ghost of the
 * list still shows through, which is the difference between floating over
 * content and being docked on a slab.
 */
const MAX_ALPHA = 0.92;
/**
 * The default is the pill's float box exactly: its height plus its margins.
 * Same box as TabBar's `floatingPlayer`, so ordinary screens neither overflow
 * the container nor leave a gap above the tab bar.
 */
const DEFAULT_HEIGHT = layout.miniPlayerFloat;

/**
 * Eased rather than linear — a straight alpha ramp puts a perceptible edge at
 * the top of the band, which is the artifact this is supposed to remove. The
 * slow start means the pill's top edge stays effectively transparent and the
 * darkening is concentrated where content meets the tab bar.
 */
const RAMP: readonly (readonly [at: number, alpha: number])[] = [
  [0, 0],
  [0.45, 0.16],
  [0.78, 0.52],
  [1, MAX_ALPHA],
];

function withAlpha(hex: string, alpha: number): string {
  return `${hex}${Math.round(alpha * 255).toString(16).padStart(2, '0')}`;
}

export function MiniPlayerScrim({
  height = DEFAULT_HEIGHT,
}: {
  /** Taller screen-owned chrome can extend the same fade without inventing a second visual. */
  height?: number;
} = {}) {
  const colors = useColors();
  const safeHeight = Math.max(0, height);
  // `bgPrimary` is guaranteed 6-digit hex by the palette invariant, so the
  // 8-digit alpha suffix is safe (same idiom as NowPlayingWash).
  const { gradientColors, positions } = useMemo(() => ({
    gradientColors: RAMP.map(([, alpha]) => withAlpha(colors.bgPrimary, alpha)),
    positions: RAMP.map(([at]) => at),
  }), [colors.bgPrimary]);

  if (safeHeight === 0) return null;

  return (
    <View pointerEvents="none" style={[styles.band, { height: safeHeight }]}>
      <Canvas style={StyleSheet.absoluteFill}>
        <Fill>
          <LinearGradient
            start={vec(0, 0)}
            end={vec(0, safeHeight)}
            colors={gradientColors}
            positions={positions}
          />
        </Fill>
      </Canvas>
    </View>
  );
}

const styles = StyleSheet.create({
  // Anchored to the bottom of the pill's float box, which is the tab bar's top
  // edge.
  band: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
  },
});

export default MiniPlayerScrim;

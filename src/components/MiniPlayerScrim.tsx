import { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import { Canvas, Fill, LinearGradient, vec } from '@shopify/react-native-skia';
import { layout } from '@/theme';
import { useColors } from '@/theme/themed';

/**
 * The gradient that lands the mini-player pill into the tab bar.
 *
 * It occupies exactly the pill's float box and no more: transparent at the
 * pill's top edge, reaching `MAX_ALPHA` where it meets the chrome. Content
 * above the pill is untouched.
 *
 * The first attempt reached ~96dp further up the screen to dim the list before
 * it got near the pill. That's the wrong job — it read as a deliberate band and
 * dimmed rows that should be clean. What actually needs softening is the seam
 * where content runs into chrome: the sliver of artwork visible in the pill's
 * side margins and in the gap above the tab bar. This should be doing its work
 * without being noticed.
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
 * The pill's float box exactly: its height plus its margins. Same box as
 * TabBar's `floatingPlayer`, so this neither overflows the container nor
 * leaves a gap above the tab bar.
 */
const HEIGHT = layout.miniPlayerFloat;

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

export function MiniPlayerScrim() {
  const colors = useColors();
  // `bgPrimary` is guaranteed 6-digit hex by the palette invariant, so the
  // 8-digit alpha suffix is safe (same idiom as NowPlayingWash).
  const { gradientColors, positions } = useMemo(() => ({
    gradientColors: RAMP.map(([, alpha]) => withAlpha(colors.bgPrimary, alpha)),
    positions: RAMP.map(([at]) => at),
  }), [colors.bgPrimary]);

  return (
    <View pointerEvents="none" style={styles.band}>
      <Canvas style={StyleSheet.absoluteFill}>
        <Fill>
          <LinearGradient
            start={vec(0, 0)}
            end={vec(0, HEIGHT)}
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
    height: HEIGHT,
  },
});

export default MiniPlayerScrim;

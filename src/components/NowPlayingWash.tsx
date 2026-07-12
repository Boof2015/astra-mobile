import { StyleSheet, View, useWindowDimensions } from 'react-native';
import { Image } from 'expo-image';
import {
  Canvas,
  LinearGradient,
  Rect,
  vec
} from '@shopify/react-native-skia';
import { useColors } from '@/theme/themed';
import { useReducedMotion } from 'react-native-reanimated';

// A faint wash of the current cover art bleeding from the very top of the
// now-playing sheet, fading back to the background before it reaches the
// artwork. Reuses the detail-header wash idiom (blurred art + Skia fade) so it
// reads as native to Astra rather than a generic full-bleed player background.
// Tune these on device — the mockup was "too bright", so start subtle.
/** Fraction of the screen height the wash spans before it's fully gone. */
const REACH = 0.42;
/** Base strength of the blurred art at the very top edge. */
const ART_OPACITY = 0.3;
/** Where the fade-to-background begins within the band (0 = top, 1 = bottom). */
const FADE_START = 0.45;
/** Matches the album/artist detail wash — blurring a low-res thumb reads as pure color. */
const BLUR_RADIUS = 40;

export function NowPlayingWash({
  artworkUri,
  offset,
}: {
  artworkUri: string | null;
  /** Negative insets so the band bleeds past the padded `content` node to the true screen edges. */
  offset: { top: number; left: number; right: number };
}) {
  const colors = useColors();
  const reduceMotion = useReducedMotion();
  const { width, height } = useWindowDimensions();
  if (!artworkUri) return null;
  const bandH = Math.round(height * REACH);
  // The band bleeds past the padded parent on both sides (offsets are negative),
  // so the fade Rect must span the full band width — not just the screen — or the
  // uncovered edge strips show the blurred image's raw cutoff.
  const bandW = Math.round(width - offset.left - offset.right);
  return (
    <View
      pointerEvents="none"
      style={{ position: 'absolute', top: offset.top, left: offset.left, right: offset.right, height: bandH }}
    >
      <Image
        source={{ uri: artworkUri }}
        style={[StyleSheet.absoluteFill, { opacity: ART_OPACITY }]}
        contentFit="cover"
        blurRadius={BLUR_RADIUS}
        transition={reduceMotion ? null : 200}
      />
      <Canvas style={StyleSheet.absoluteFill}>
        <Rect x={0} y={0} width={bandW} height={bandH}>
          <LinearGradient
            start={vec(0, 0)}
            end={vec(0, bandH)}
            colors={[`${colors.bgPrimary}00`, `${colors.bgPrimary}00`, colors.bgPrimary]}
            positions={[0, FADE_START, 1]}
          />
        </Rect>
      </Canvas>
    </View>
  );
}

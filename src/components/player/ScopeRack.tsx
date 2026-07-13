import { StyleSheet, View } from 'react-native';
import {
  Blur,
  BlurMask,
  Canvas,
  Group,
  Image as SkiaImage,
  Mask,
  RoundedRect,
  useImage,
} from '@shopify/react-native-skia';
import { OscilloscopeWave } from '@/components/OscilloscopeWave';
import { SpectrumCurve } from '@/components/SpectrumCurve';
import { getScopeHeight } from '@/components/player/nowPlayingLayout';
import { useScopeActive } from '@/scope/scopeStore';
import { spacing } from '@/theme';
import { createThemedStyles } from '@/theme/themed';

// 60fps cap, matching Visualizer — display-sync starved the JS thread on
// high-refresh devices.
const STAGE_FRAME_MS = 16;
// The rack artwork is atmosphere, not a second cover card. It bleeds beyond
// the old frame, stays softly defocused, and contributes restrained color.
const BACKDROP_BLUR_RADIUS = 10;
const BACKDROP_BLEED = 40;
const BACKDROP_IMAGE_OPACITY = 0.66;
const BACKDROP_MASK_INSET_RATIO = 0.16;
const BACKDROP_MASK_BLUR_RATIO = 0.08;
// Wide dissolve so the overflowing strips melt out instead of hard-stopping.
const STRIP_EDGE_FADE_WIDTH = 56;

interface ScopeRackProps {
  /** Former art-card edge length; the ambient backdrop bleeds beyond it. */
  size: number;
  /** Strip span (the rail's width): wider than the card, overflowing it. */
  stripWidth: number;
  artworkUri: string | null;
  /** Freeze the scopes without unmounting (overlay closed / queue open). */
  paused?: boolean;
}

/**
 * Rack-style scope face: both instruments stacked at their natural wide aspect
 * (oscilloscope above, spectrum grounded below). The blurred, dimmed artwork
 * backdrop dissolves past the former card frame, while the strips span the
 * full rail width and independently fade at their ends.
 */
export function ScopeRack({ size, stripWidth, artworkUri, paused = false }: ScopeRackProps) {
  const styles = useStyles();
  const artwork = useImage(artworkUri);
  const active = useScopeActive() && !paused;
  const width = Math.max(0, stripWidth);
  const stripHeight = getScopeHeight(width);
  const backdropSize = size + BACKDROP_BLEED * 2;
  const maskInset = backdropSize * BACKDROP_MASK_INSET_RATIO;
  const maskBlur = backdropSize * BACKDROP_MASK_BLUR_RATIO;

  return (
    <View style={{ width: size, height: size }}>
      <View
        style={[
          styles.backdrop,
          {
            top: -BACKDROP_BLEED,
            left: -BACKDROP_BLEED,
            width: backdropSize,
            height: backdropSize,
          },
        ]}
      >
        {artwork ? (
          <Canvas pointerEvents="none" style={StyleSheet.absoluteFill}>
            <Mask
              mode="alpha"
              mask={
                <RoundedRect
                  x={maskInset}
                  y={maskInset}
                  width={backdropSize - maskInset * 2}
                  height={backdropSize - maskInset * 2}
                  r={maskInset * 0.6}
                  color="white"
                >
                  <BlurMask blur={maskBlur} style="normal" />
                </RoundedRect>
              }
            >
              <Group opacity={BACKDROP_IMAGE_OPACITY}>
                <SkiaImage
                  image={artwork}
                  x={0}
                  y={0}
                  width={backdropSize}
                  height={backdropSize}
                  fit="cover"
                >
                  <Blur blur={BACKDROP_BLUR_RADIUS} mode="clamp" />
                </SkiaImage>
              </Group>
            </Mask>
          </Canvas>
        ) : null}
      </View>
      <View style={[styles.strips, { width, left: (size - width) / 2 }]}>
        <OscilloscopeWave
          active={active}
          frameMs={STAGE_FRAME_MS}
          width={width}
          height={stripHeight}
          glow
          edgeFade
          edgeFadeWidth={STRIP_EDGE_FADE_WIDTH}
        />
        <SpectrumCurve
          active={active}
          frameMs={STAGE_FRAME_MS}
          width={width}
          height={stripHeight}
          glow
          edgeFade
          edgeFadeWidth={STRIP_EDGE_FADE_WIDTH}
        />
      </View>
    </View>
  );
}

const useStyles = createThemedStyles(() => ({
  backdrop: {
    position: 'absolute',
  },
  strips: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xl,
  },
}));

export default ScopeRack;

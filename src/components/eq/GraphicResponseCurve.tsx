import { useMemo, useState } from 'react';
import { StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import { Canvas, DashPathEffect, Group, Path, Skia, type SkPath } from '@shopify/react-native-skia';
import { colors } from '@/theme';
import type { EQBand } from '@/types/audio';
import {
  EQ_MAX_FREQUENCY,
  EQ_MAX_GAIN_DB,
  EQ_MIN_FREQUENCY,
  computeCombinedEQMagnitude,
} from '@/audio/eq';
import { GRAPHIC_BANDS, buildGraphicBands } from '@/audio/graphicEq';
import { GRAPH_SAMPLE_RATE, buildResponseFill } from './eqGraphMath';

const SAMPLES = 96;

interface GraphicResponseCurveProps {
  gains: number[];
  enabled: boolean;
}

/**
 * Response curve drawn in the slider row's coordinate space so it tracks the
 * thumbs 1:1: band frequencies land on the evenly spaced column centers
 * (piecewise-log x between them), and gain spans the full track height with the
 * 0 dB midline at the track midline — the same mapping as the thumb centers.
 * Rendered behind the sliders; transparent background (the editor card owns
 * the chrome).
 */
export function GraphicResponseCurve({ gains, enabled }: GraphicResponseCurveProps) {
  const [size, setSize] = useState({ width: 0, height: 0 });
  const width = size.width;
  const height = size.height;

  const bands = useMemo(() => buildGraphicBands(gains), [gains]);
  const linePath = useMemo(() => buildAlignedResponsePath(bands, width, height), [bands, width, height]);
  const fillPath = useMemo(
    () => buildResponseFill(linePath, width, height),
    [linePath, width, height]
  );

  const onLayout = (e: LayoutChangeEvent) => {
    const next = { width: e.nativeEvent.layout.width, height: e.nativeEvent.layout.height };
    setSize((prev) => (prev.width === next.width && prev.height === next.height ? prev : next));
  };

  const curveColor = enabled ? colors.accent : colors.textTertiary;

  return (
    <View style={styles.container} onLayout={onLayout} pointerEvents="none">
      {width > 0 && height > 0 ? (
        <Canvas style={StyleSheet.absoluteFill}>
          {/* Grid: ±6 dB lines + dashed 0 dB midline (track coordinates). */}
          <Group>
            <Path
              path={hLine(gainToTrackY(6, height), width)}
              color={colors.glassBorder}
              style="stroke"
              strokeWidth={1}
            />
            <Path
              path={hLine(gainToTrackY(-6, height), width)}
              color={colors.glassBorder}
              style="stroke"
              strokeWidth={1}
            />
            <Path path={hLine(height / 2, width)} color={colors.glassBorder} style="stroke" strokeWidth={1}>
              <DashPathEffect intervals={[3, 5]} />
            </Path>
          </Group>

          <Path path={fillPath} color={withAlpha(curveColor, 0.1)} style="fill" />
          <Path
            path={linePath}
            color={curveColor}
            style="stroke"
            strokeWidth={2}
            strokeJoin="round"
            strokeCap="round"
          />
        </Canvas>
      ) : null}
    </View>
  );
}

/** Gain → y across the full track height (thumb-center scale, no graph padding). */
function gainToTrackY(db: number, height: number): number {
  const clamped = Math.max(-EQ_MAX_GAIN_DB, Math.min(EQ_MAX_GAIN_DB, db));
  return (1 - (clamped + EQ_MAX_GAIN_DB) / (2 * EQ_MAX_GAIN_DB)) * height;
}

/**
 * x → frequency with band frequencies pinned to the column centers: log-lerp
 * between adjacent bands, extending to the EQ range limits at the edges.
 */
function xToAlignedFreq(x: number, width: number): number {
  const n = GRAPHIC_BANDS.length;
  const center = (i: number) => ((i + 0.5) / n) * width;
  if (x <= center(0)) {
    return logLerp(EQ_MIN_FREQUENCY, GRAPHIC_BANDS[0].frequency, x / Math.max(1, center(0)));
  }
  if (x >= center(n - 1)) {
    const t = (x - center(n - 1)) / Math.max(1, width - center(n - 1));
    return logLerp(GRAPHIC_BANDS[n - 1].frequency, EQ_MAX_FREQUENCY, t);
  }
  const i = Math.min(n - 2, Math.max(0, Math.floor((x / width) * n - 0.5)));
  const t = (x - center(i)) / Math.max(1, center(i + 1) - center(i));
  return logLerp(GRAPHIC_BANDS[i].frequency, GRAPHIC_BANDS[i + 1].frequency, t);
}

function logLerp(a: number, b: number, t: number): number {
  return 10 ** (Math.log10(a) + (Math.log10(b) - Math.log10(a)) * Math.max(0, Math.min(1, t)));
}

function buildAlignedResponsePath(bands: readonly EQBand[], width: number, height: number): SkPath {
  const path = Skia.Path.Make();
  if (width <= 0 || height <= 0) return path;
  for (let s = 0; s <= SAMPLES; s++) {
    const x = (s / SAMPLES) * width;
    const db = computeCombinedEQMagnitude(bands, xToAlignedFreq(x, width), GRAPH_SAMPLE_RATE);
    const y = gainToTrackY(db, height);
    if (s === 0) path.moveTo(x, y);
    else path.lineTo(x, y);
  }
  return path;
}

function hLine(y: number, width: number): SkPath {
  const p = Skia.Path.Make();
  p.moveTo(0, y);
  p.lineTo(width, y);
  return p;
}

function withAlpha(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
});

export default GraphicResponseCurve;

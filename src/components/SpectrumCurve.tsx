import { useMemo } from 'react';
import { Canvas, Group, LinearGradient, Path, Skia, vec } from '@shopify/react-native-skia';
import { colors } from '@/theme';

interface SpectrumCurveProps {
  /** Normalized magnitudes in [0,1], one per point (see useSpectrumCurve). */
  values: number[];
  width: number;
  height: number;
  /** Hex line/fill color (e.g. theme accent). Defaults to the cyan accent. */
  color?: string;
  lineWidth?: number;
  /** 0..1 multiplier on the gradient fill under the line. */
  fillOpacity?: number;
  /** Adds a soft wider stroke under the line for a glow. */
  glow?: boolean;
}

/** #rrggbb -> rgba() with the given alpha. */
function withAlpha(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/**
 * Builds a smooth (quadratic-through-midpoints) path for the line, plus a copy
 * closed to the baseline for the gradient fill. Same curve the desktop spectrum
 * draws, ported to Skia.
 */
function buildPaths(values: number[], width: number, height: number, pad: number) {
  const line = Skia.Path.Make();
  const n = values.length;
  if (n < 2 || width <= 0 || height <= 0) return { line, fill: line.copy() };

  const usableH = height - pad * 2;
  const xAt = (i: number) => (i / (n - 1)) * width;
  const yAt = (i: number) => {
    const v = values[i] < 0 ? 0 : values[i] > 1 ? 1 : values[i];
    return pad + (1 - v) * usableH;
  };

  line.moveTo(xAt(0), yAt(0));
  for (let i = 1; i < n; i++) {
    const midX = (xAt(i - 1) + xAt(i)) * 0.5;
    const midY = (yAt(i - 1) + yAt(i)) * 0.5;
    line.quadTo(xAt(i - 1), yAt(i - 1), midX, midY);
  }
  line.lineTo(xAt(n - 1), yAt(n - 1));

  const fill = line.copy();
  fill.lineTo(width, height);
  fill.lineTo(0, height);
  fill.close();

  return { line, fill };
}

/**
 * Filled-line spectrum (the desktop "CURVE" look): a smooth line over a vertical
 * gradient fill. Source-agnostic — give it normalized values and a size.
 */
export function SpectrumCurve({
  values,
  width,
  height,
  color = colors.accent,
  lineWidth = 2,
  fillOpacity = 1,
  glow = false,
}: SpectrumCurveProps) {
  const pad = lineWidth;
  const { line, fill } = useMemo(
    () => buildPaths(values, width, height, pad),
    [values, width, height, pad]
  );

  if (width <= 0 || height <= 0) return null;

  return (
    <Canvas style={{ width, height }}>
      <Group opacity={fillOpacity}>
        <Path path={fill}>
          <LinearGradient
            start={vec(0, 0)}
            end={vec(0, height)}
            colors={[withAlpha(color, 0.38), withAlpha(color, 0.08), withAlpha(color, 0)]}
          />
        </Path>
      </Group>
      {glow && (
        <Path
          path={line}
          style="stroke"
          strokeWidth={lineWidth * 3}
          strokeJoin="round"
          strokeCap="round"
          color={withAlpha(color, 0.18)}
        />
      )}
      <Path
        path={line}
        style="stroke"
        strokeWidth={lineWidth}
        strokeJoin="round"
        strokeCap="round"
        color={color}
      />
    </Canvas>
  );
}

export default SpectrumCurve;

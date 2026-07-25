import { useMemo } from 'react';
import { processColor } from 'react-native';
import { useReducedMotion } from 'react-native-reanimated';
import { AstraScopeView } from '../../modules/astra-scope';
import { useColors } from '@/theme/themed';

interface SpectrumCurveProps {
  /** Normalized magnitudes in [0,1] for static rendering. Live rendering ignores this. */
  values?: ArrayLike<number>;
  width: number;
  height: number;
  /** Pull native spectrum frames while active, bypassing React per-frame state. */
  active?: boolean;
  /** Which native tap to pull from. 'post' is the post-EQ ring (EQ screen). */
  source?: 'pre' | 'post';
  /** Number of log-frequency render points. */
  pointCount?: number;
  /** Active render cadence. 0 means display-sync; 32 keeps the mini-player battery-friendly. */
  frameMs?: number;
  /** Native analysis cadence. Defaults to frameMs. */
  analysisFrameMs?: number;
  /** Previous native spectrum-frame retention in [0, 0.99]. */
  smoothing?: number;
  dbMin?: number;
  dbMax?: number;
  tiltDbPerOctave?: number;
  color?: string;
  lineWidth?: number;
  lineOpacity?: number;
  fillOpacity?: number;
  glow?: boolean;
  glowOpacity?: number;
  edgeFade?: boolean;
  edgeFadeWidth?: number;
}

const DEFAULT_POINTS = 120;
const MINI_FRAME_MS = 32;
const DEFAULT_SMOOTHING = 0.92;
const DISPLAY_DB_MIN = -90;
const DISPLAY_DB_MAX = -10;
const TILT_DB_PER_OCTAVE = 3.5;

/**
 * Thin React wrapper. FFT projection, pause decay, path preparation, and frame
 * scheduling all live in AstraScopeView's serialized Android worker.
 */
export function SpectrumCurve({
  values,
  width,
  height,
  active = false,
  source = 'pre',
  pointCount,
  frameMs = MINI_FRAME_MS,
  analysisFrameMs,
  smoothing = DEFAULT_SMOOTHING,
  dbMin = DISPLAY_DB_MIN,
  dbMax = DISPLAY_DB_MAX,
  tiltDbPerOctave = TILT_DB_PER_OCTAVE,
  color: colorProp,
  lineWidth = 2,
  lineOpacity = 1,
  fillOpacity = 1,
  glow = false,
  glowOpacity = 0.18,
  edgeFade = false,
  edgeFadeWidth = 28,
}: SpectrumCurveProps) {
  const colors = useColors();
  const reducedMotion = useReducedMotion();
  const activePointCount = Math.min(160, Math.max(96, Math.floor(width / 2)));
  const resolvedPointCount =
    pointCount ?? values?.length ?? (active ? activePointCount : DEFAULT_POINTS);
  const staticValues = useMemo(
    () => (values ? Array.from(values) : undefined),
    [values]
  );
  const color = processColor(colorProp ?? colors.accent);

  if (width <= 0 || height <= 0 || typeof color !== 'number') return null;
  return (
    <AstraScopeView
      mode="spectrum"
      source={source}
      active={active && !reducedMotion}
      reducedMotion={reducedMotion}
      frameMs={frameMs}
      analysisFrameMs={analysisFrameMs ?? frameMs}
      smoothing={smoothing}
      pointCount={resolvedPointCount}
      dbMin={dbMin}
      dbMax={dbMax}
      tiltDbPerOctave={tiltDbPerOctave}
      color={color}
      lineWidth={lineWidth}
      lineOpacity={lineOpacity}
      fillOpacity={fillOpacity}
      glow={glow}
      glowOpacity={glowOpacity}
      edgeFade={edgeFade}
      edgeFadeWidth={edgeFadeWidth}
      values={staticValues}
      pointerEvents="none"
      collapsable={false}
      style={{ width, height }}
    />
  );
}

export default SpectrumCurve;

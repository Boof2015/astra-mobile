import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef
} from 'react';
import { useReducedMotion } from 'react-native-reanimated';
import {
  PaintStyle,
  Skia,
  SkiaPictureView,
  StrokeCap,
  StrokeJoin,
  TileMode,
  type SkPath,
  type SkPicture
} from '@shopify/react-native-skia';
import { AstraScope, OSCILLOSCOPE_POINTS } from '../../modules/astra-scope';
import { useScopeStore } from '@/scope/scopeStore';
import { DEFAULT_OSC_GAIN } from '@/scope/oscilloscopeGain';
import { useColors } from '@/theme/themed';

interface OscilloscopeWaveProps {
  active: boolean;
  width: number;
  height: number;
  /** Live render cadence; 0 means display-sync. */
  frameMs?: number;
  color?: string;
  lineWidth?: number;
  glow?: boolean;
  edgeFade?: boolean;
  edgeFadeWidth?: number;
}

type SkiaViewApiShape = {
  setJsiProperty: <T>(nativeId: number, name: string, value: T) => void;
  requestRedraw: (nativeId: number) => void;
};

const values = new Float32Array(OSCILLOSCOPE_POINTS);

// Deactivation decay: pull the last live frame toward the rest line over
// ~250ms instead of snapping flat, so pausing reads as powering down.
const DECAY_PER_FRAME = 0.72;
const REST_EPSILON = 0.004;

type SkiaDisposable = { dispose: () => void };

function disposeSkiaResources(resources: readonly (SkiaDisposable | null)[]) {
  for (let i = resources.length - 1; i >= 0; i--) resources[i]?.dispose();
}

function skiaViewApi(): SkiaViewApiShape | null {
  const globalWithSkia = globalThis as typeof globalThis & { SkiaViewApi?: SkiaViewApiShape };
  return globalWithSkia.SkiaViewApi ?? null;
}

function withAlpha(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function makeStrokePaint(color: string, width: number, alpha = 1) {
  const paint = Skia.Paint();
  paint.setAntiAlias(true);
  paint.setColor(Skia.Color(alpha === 1 ? color : withAlpha(color, alpha)));
  paint.setStrokeWidth(width);
  paint.setStyle(PaintStyle.Stroke);
  paint.setStrokeCap(StrokeCap.Round);
  paint.setStrokeJoin(StrokeJoin.Round);
  return paint;
}

const EDGE_FADE_WIDTH = 28;

/**
 * Edge fade baked into the stroke paint: a horizontal gradient shader whose
 * alpha ramps in from transparent at both ends, so the trace dissolves at its
 * edges over any background — solid screen or blurred artwork.
 */
function makeFadedStrokeShader(
  color: string,
  alpha: number,
  width: number,
  fadeWidth: number
) {
  const f = Math.min(fadeWidth, width * 0.5);
  return Skia.Shader.MakeLinearGradient(
    { x: 0, y: 0 },
    { x: width, y: 0 },
    [
      Skia.Color(withAlpha(color, 0)),
      Skia.Color(withAlpha(color, alpha)),
      Skia.Color(withAlpha(color, alpha)),
      Skia.Color(withAlpha(color, 0)),
    ],
    [0, f / width, 1 - f / width, 1],
    TileMode.Clamp
  );
}

function writeWavePath(
  samples: Float32Array,
  sampleCount: number,
  width: number,
  height: number,
  lineWidth: number,
  gain: number,
  path: SkPath
) {
  path.reset();
  const n = Math.min(sampleCount, samples.length);
  if (n < 2 || width <= 0 || height <= 0) return;

  const mid = height / 2;
  const amp = mid - lineWidth;
  const xAt = (i: number) => (i / (n - 1)) * width;
  const yAt = (i: number) => {
    let v = samples[i] * gain;
    // Per-track gain targets ~85% of full scale, so this only catches the rare
    // intra-track peak that runs a touch hotter than the analyzed sample peak.
    if (v < -1) v = -1;
    else if (v > 1) v = 1;
    return mid - v * amp;
  };

  path.moveTo(0, yAt(0));
  for (let i = 1; i < n; i++) {
    path.lineTo(xAt(i), yAt(i));
  }
}

function buildPicture(
  samples: Float32Array,
  sampleCount: number,
  width: number,
  height: number,
  color: string,
  lineWidth: number,
  glow: boolean,
  gain: number,
  edgeFade: boolean,
  edgeFadeWidth: number
): SkPicture {
  const recorder = Skia.PictureRecorder();
  const canvas = recorder.beginRecording(Skia.XYWHRect(0, 0, width, height));
  const path = Skia.Path.Make();
  const resources: SkiaDisposable[] = [recorder, path];
  writeWavePath(samples, sampleCount, width, height, lineWidth, gain, path);

  try {
    if (glow) {
      const glowPaint = makeStrokePaint(color, lineWidth * 3, 0.18);
      resources.push(glowPaint);
      if (edgeFade) {
        const glowShader = makeFadedStrokeShader(color, 0.18, width, edgeFadeWidth);
        resources.push(glowShader);
        glowPaint.setShader(glowShader);
      }
      canvas.drawPath(path, glowPaint);
    }
    const strokePaint = makeStrokePaint(color, lineWidth);
    resources.push(strokePaint);
    if (edgeFade) {
      const strokeShader = makeFadedStrokeShader(color, 1, width, edgeFadeWidth);
      resources.push(strokeShader);
      strokePaint.setShader(strokeShader);
    }
    canvas.drawPath(path, strokePaint);
    return recorder.finishRecordingAsPicture();
  } finally {
    disposeSkiaResources(resources);
  }
}

/**
 * Imperative oscilloscope renderer. This mirrors desktop/prism's hot path:
 * a frame loop pulls native scope data and draws directly into a canvas-like
 * surface instead of routing each frame through React reconciliation.
 *
 * Amplitude uses a per-track display gain (scopeStore.oscGain, set once per track by
 * useNormalizationSync) — read fresh each frame so it tracks song changes, but held
 * constant within a track so the music's own dynamics are preserved.
 */
export function OscilloscopeWave({
  active,
  width,
  height,
  frameMs = 16,
  color: colorProp,
  lineWidth = 2,
  glow = false,
  edgeFade = false,
  edgeFadeWidth = EDGE_FADE_WIDTH,
}: OscilloscopeWaveProps) {
  const themeColors = useColors();
  const color = colorProp ?? themeColors.accent;
  const reduceMotion = useReducedMotion();
  const viewRef = useRef<SkiaPictureView | null>(null);
  const initialPicture = useMemo(
    () =>
      buildPicture(
        values,
        values.length,
        Math.max(1, width),
        Math.max(1, height),
        color,
        lineWidth,
        glow,
        DEFAULT_OSC_GAIN,
        edgeFade,
        edgeFadeWidth
      ),
    [color, edgeFade, edgeFadeWidth, glow, height, lineWidth, width]
  );

  useEffect(() => () => initialPicture.dispose(), [initialPicture]);

  useLayoutEffect(
    () => () => {
      const view = viewRef.current;
      const api = skiaViewApi();
      if (!view || !api) return;
      api.setJsiProperty(view.nativeId, 'picture', null);
      api.requestRedraw(view.nativeId);
    },
    []
  );

  useLayoutEffect(() => {
    const view = viewRef.current;
    const api = skiaViewApi();
    if (!view || !api || width <= 0 || height <= 0) return;

    let mounted = true;
    let raf = 0;
    let lastDraw = 0;
    const drawThreshold = frameMs > 0 ? Math.max(0, frameMs - 0.5) : 0;

    // Paints and the path live for the whole effect run; per-frame allocation
    // was measurable GC/JSI churn at 60fps.
    const strokePaint = makeStrokePaint(color, lineWidth);
    const glowPaint = glow ? makeStrokePaint(color, lineWidth * 3, 0.18) : null;
    const effectResources: SkiaDisposable[] = [strokePaint];
    if (glowPaint) effectResources.push(glowPaint);
    if (edgeFade) {
      const strokeShader = makeFadedStrokeShader(color, 1, width, edgeFadeWidth);
      effectResources.push(strokeShader);
      strokePaint.setShader(strokeShader);
      if (glowPaint) {
        const glowShader = makeFadedStrokeShader(color, 0.18, width, edgeFadeWidth);
        effectResources.push(glowShader);
        glowPaint.setShader(glowShader);
      }
    }
    const bounds = Skia.XYWHRect(0, 0, width, height);
    const path = Skia.Path.Make();
    effectResources.push(path);
    let currentPicture: SkPicture | null = null;

    const draw = (sampleCount: number) => {
      const gain = useScopeStore.getState().oscGain;
      writeWavePath(values, sampleCount, width, height, lineWidth, gain, path);
      const recorder = Skia.PictureRecorder();
      const canvas = recorder.beginRecording(bounds);
      if (glowPaint) canvas.drawPath(path, glowPaint);
      canvas.drawPath(path, strokePaint);
      const nextPicture = recorder.finishRecordingAsPicture();
      recorder.dispose();
      api.setJsiProperty(view.nativeId, 'picture', nextPicture);
      api.requestRedraw(view.nativeId);
      currentPicture?.dispose();
      currentPicture = nextPicture;
    };

    const cleanup = () => {
      mounted = false;
      cancelAnimationFrame(raf);
      api.setJsiProperty(view.nativeId, 'picture', null);
      api.requestRedraw(view.nativeId);
      currentPicture?.dispose();
      currentPicture = null;
      disposeSkiaResources(effectResources);
    };

    if (!active) {
      // Deactivation (pause, occlusion): decay whatever the tap last wrote
      // toward the rest line, then settle flat and schedule nothing.
      let peak = 0;
      for (let i = 0; i < values.length; i++) {
        const a = Math.abs(values[i]);
        if (a > peak) peak = a;
      }
      if (reduceMotion || peak < REST_EPSILON) {
        values.fill(0);
        draw(values.length);
        return cleanup;
      }
      const decayTick = (t: number) => {
        if (!mounted) return;
        if (drawThreshold > 0 && t - lastDraw < drawThreshold) {
          raf = requestAnimationFrame(decayTick);
          return;
        }
        lastDraw = t;
        let max = 0;
        for (let i = 0; i < values.length; i++) {
          const v = values[i] * DECAY_PER_FRAME;
          values[i] = v;
          const a = Math.abs(v);
          if (a > max) max = a;
        }
        if (max < REST_EPSILON) {
          values.fill(0);
          draw(values.length);
          return;
        }
        draw(values.length);
        raf = requestAnimationFrame(decayTick);
      };
      raf = requestAnimationFrame(decayTick);
      return cleanup;
    }

    values.fill(0);
    draw(values.length);

    const tick = (t: number) => {
      if (!mounted) return;
      raf = requestAnimationFrame(tick);
      if (drawThreshold > 0 && t - lastDraw < drawThreshold) return;

      const n = AstraScope.getOscilloscopeFrame(values);
      if (n > 0) {
        lastDraw = t;
        draw(n);
      }
    };

    raf = requestAnimationFrame(tick);
    return cleanup;
  }, [
    active,
    color,
    edgeFade,
    edgeFadeWidth,
    frameMs,
    glow,
    height,
    lineWidth,
    reduceMotion,
    width,
  ]);

  if (width <= 0 || height <= 0) return null;
  return <SkiaPictureView ref={viewRef} picture={initialPicture} style={{ width, height }} />;
}

export default OscilloscopeWave;

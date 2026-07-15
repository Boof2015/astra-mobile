import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef
} from 'react';
import { useReducedMotion } from 'react-native-reanimated';
import {
  BlendMode,
  PaintStyle,
  Skia,
  SkiaPictureView,
  StrokeCap,
  StrokeJoin,
  TileMode,
  type SkPath,
  type SkPicture
} from '@shopify/react-native-skia';
import { AstraScope, SPECTRUM_BINS } from '../../modules/astra-scope';
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
  /** Number of render points when active. Defaults to one point per rendered pixel. */
  pointCount?: number;
  /** Active render cadence. 0 means display-sync; 32 keeps the mini-player battery-friendly. */
  frameMs?: number;
  /** Native pull cadence. Defaults to frameMs; 0 advances analysis every display frame. */
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

type SkiaViewApiShape = {
  setJsiProperty: <T>(nativeId: number, name: string, value: T) => void;
  requestRedraw: (nativeId: number) => void;
};

const DEFAULT_POINTS = 120;
const MINI_FRAME_MS = 32;
const DEFAULT_SMOOTHING = 0.92;
const DISPLAY_DB_MIN = -90;
const DISPLAY_DB_MAX = -10;
const SPECTRUM_SAMPLE_RATE = 48000;
const MIN_FREQUENCY = 20;
const MAX_FREQUENCY = 20000;
const TILT_DB_PER_OCT = 3.5;
const TILT_REFERENCE_HZ = 1000;
// Deactivation decay: let the last live curve fall to the floor over ~250ms
// instead of freezing mid-song, so pausing reads as powering down.
const DECAY_PER_FRAME = 0.72;
const REST_EPSILON = 0.004;
const spectrumBins = new Float32Array(SPECTRUM_BINS);

type SkiaDisposable = { dispose: () => void };

function disposeSkiaResources(resources: readonly (SkiaDisposable | null)[]) {
  for (let i = resources.length - 1; i >= 0; i--) resources[i]?.dispose();
}

function skiaViewApi(): SkiaViewApiShape | null {
  const globalWithSkia = globalThis as typeof globalThis & { SkiaViewApi?: SkiaViewApiShape };
  return globalWithSkia.SkiaViewApi ?? null;
}

/** #rrggbb -> rgba() with the given alpha. */
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

/**
 * Edge fade baked into the paints: a horizontal alpha ramp so the curve
 * dissolves at its ends over any background — solid screen or blurred artwork.
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

/** White-with-alpha horizontal ramp; Modulate-blending it onto another shader
 * multiplies alphas while leaving color untouched. */
function makeFadeMaskShader(width: number, fadeWidth: number) {
  const f = Math.min(fadeWidth, width * 0.5);
  return Skia.Shader.MakeLinearGradient(
    { x: 0, y: 0 },
    { x: width, y: 0 },
    [
      Skia.Color('rgba(255, 255, 255, 0)'),
      Skia.Color('rgba(255, 255, 255, 1)'),
      Skia.Color('rgba(255, 255, 255, 1)'),
      Skia.Color('rgba(255, 255, 255, 0)'),
    ],
    [0, f / width, 1 - f / width, 1],
    TileMode.Clamp
  );
}

function makeFillPaint(
  color: string,
  height: number,
  opacity: number,
  fade: { width: number; fadeWidth: number } | null = null
) {
  const paint = Skia.Paint();
  paint.setAntiAlias(true);
  paint.setStyle(PaintStyle.Fill);
  const vertical = Skia.Shader.MakeLinearGradient(
    { x: 0, y: 0 },
    { x: 0, y: height },
    [
      Skia.Color(withAlpha(color, 0.38 * opacity)),
      Skia.Color(withAlpha(color, 0.08 * opacity)),
      Skia.Color(withAlpha(color, 0)),
    ],
    null,
    TileMode.Clamp
  );
  const shaders: SkiaDisposable[] = [vertical];
  if (fade) {
    const mask = makeFadeMaskShader(fade.width, fade.fadeWidth);
    const blended = Skia.Shader.MakeBlend(BlendMode.Modulate, vertical, mask);
    shaders.push(mask, blended);
    paint.setShader(blended);
  } else {
    paint.setShader(vertical);
  }
  return { paint, shaders };
}

function writePaths(
  values: ArrayLike<number>,
  width: number,
  height: number,
  pad: number,
  line: SkPath,
  fill: SkPath
) {
  line.reset();
  fill.reset();
  const n = values.length;
  if (n < 2 || width <= 0 || height <= 0) return;

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

  fill.addPath(line);
  fill.lineTo(width, height);
  fill.lineTo(0, height);
  fill.close();
}

function buildPaths(values: ArrayLike<number>, width: number, height: number, pad: number) {
  const line = Skia.Path.Make();
  const fill = Skia.Path.Make();
  writePaths(values, width, height, pad, line, fill);
  return { line, fill };
}

function buildPicture(
  values: ArrayLike<number>,
  width: number,
  height: number,
  color: string,
  lineWidth: number,
  lineOpacity: number,
  fillOpacity: number,
  glow: boolean,
  glowOpacity: number,
  edgeFade: boolean,
  edgeFadeWidth: number
): SkPicture {
  const recorder = Skia.PictureRecorder();
  const canvas = recorder.beginRecording(Skia.XYWHRect(0, 0, width, height));
  const { line, fill } = buildPaths(values, width, height, lineWidth);
  const resources: SkiaDisposable[] = [recorder, line, fill];

  try {
    if (values.length >= 2 && width > 0 && height > 0) {
      const fade = edgeFade && edgeFadeWidth > 0 ? { width, fadeWidth: edgeFadeWidth } : null;
      const fillResources = makeFillPaint(color, height, fillOpacity, fade);
      resources.push(fillResources.paint, ...fillResources.shaders);
      canvas.drawPath(fill, fillResources.paint);
      if (glow) {
        const glowPaint = makeStrokePaint(color, lineWidth * 3, glowOpacity);
        resources.push(glowPaint);
        if (fade) {
          const glowShader = makeFadedStrokeShader(color, glowOpacity, width, edgeFadeWidth);
          resources.push(glowShader);
          glowPaint.setShader(glowShader);
        }
        canvas.drawPath(line, glowPaint);
      }
      const strokePaint = makeStrokePaint(color, lineWidth, lineOpacity);
      resources.push(strokePaint);
      if (fade) {
        const strokeShader = makeFadedStrokeShader(color, lineOpacity, width, edgeFadeWidth);
        resources.push(strokeShader);
        strokePaint.setShader(strokeShader);
      }
      canvas.drawPath(line, strokePaint);
    }
    return recorder.finishRecordingAsPicture();
  } finally {
    disposeSkiaResources(resources);
  }
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function interpolatedValue(data: Float32Array, index: number): number {
  const i0 = Math.max(0, Math.min(data.length - 1, Math.floor(index)));
  const i1 = Math.min(i0 + 1, data.length - 1);
  return lerp(data[i0], data[i1], index - i0);
}

function frequencyAtPosition(t: number, minFrequency: number, maxFrequency: number): number {
  const logMin = Math.log10(minFrequency);
  const logMax = Math.log10(maxFrequency);
  return 10 ** (logMin + t * (logMax - logMin));
}

function peakInRange(data: Float32Array, startIndex: number, endIndex: number, binWidth: number) {
  const clampedStart = Math.max(0, Math.min(data.length - 1, startIndex));
  const clampedEnd = Math.max(0, Math.min(data.length - 1, endIndex));
  const lo = Math.floor(Math.min(clampedStart, clampedEnd));
  const hi = Math.ceil(Math.max(clampedStart, clampedEnd));

  if (hi <= lo) {
    return {
      rawDb: interpolatedValue(data, clampedStart),
      frequencyHz: Math.max(0, clampedStart * binWidth),
    };
  }

  let peakBin = lo;
  let peakDb = Number.NEGATIVE_INFINITY;
  for (let i = lo; i <= hi; i++) {
    if (data[i] > peakDb) {
      peakDb = data[i];
      peakBin = i;
    }
  }

  if (peakBin > 0 && peakBin < data.length - 1) {
    const y1 = data[peakBin - 1];
    const y2 = data[peakBin];
    const y3 = data[peakBin + 1];
    const denominator = y1 - 2 * y2 + y3;
    if (Math.abs(denominator) > 1e-9) {
      const offset = Math.max(-0.5, Math.min(0.5, 0.5 * (y1 - y3) / denominator));
      return {
        rawDb: y2 - 0.25 * (y1 - y3) * offset,
        frequencyHz: Math.max(0, (peakBin + offset) * binWidth),
      };
    }
  }

  return {
    rawDb: peakDb,
    frequencyHz: Math.max(0, peakBin * binWidth),
  };
}

interface SpectrumPointOptions {
  dbMin: number;
  dbMax: number;
  tiltDbPerOctave: number;
}

function applyTilt(db: number, frequency: number, tiltDbPerOctave: number): number {
  const safeFreq = Math.max(1, frequency);
  return db + tiltDbPerOctave * Math.log2(safeFreq / TILT_REFERENCE_HZ);
}

function writeSpectrumPoints(rawBins: Float32Array, out: Float32Array, options: SpectrumPointOptions) {
  const pointCount = out.length;
  const bufferLength = rawBins.length;
  const nyquist = SPECTRUM_SAMPLE_RATE / 2;
  const minFrequency = Math.max(1, Math.min(MIN_FREQUENCY, nyquist));
  const maxFrequency = Math.max(minFrequency + 1, Math.min(MAX_FREQUENCY, nyquist));
  const binWidth = nyquist / bufferLength;
  const dbRange = Math.max(1, options.dbMax - options.dbMin);

  for (let p = 0; p < pointCount; p++) {
    const t0 = p / (pointCount - 1);
    const t1 = Math.min(1, (p + 1) / (pointCount - 1));
    const frequency0 = frequencyAtPosition(t0, minFrequency, maxFrequency);
    const frequency1 = frequencyAtPosition(t1, minFrequency, maxFrequency);
    const centerFrequency = (frequency0 + frequency1) * 0.5;
    const bin0 = frequency0 / binWidth;
    const bin1 = frequency1 / binWidth;
    const centerBin = (bin0 + bin1) * 0.5;
    const binSpan = Math.abs(bin1 - bin0);
    const rawDb =
      binSpan <= 1
        ? interpolatedValue(rawBins, Math.min(centerBin, bufferLength - 1))
        : peakInRange(rawBins, bin0, bin1, binWidth).rawDb;
    const db = applyTilt(rawDb, centerFrequency, options.tiltDbPerOctave);

    let norm = (db - options.dbMin) / dbRange;
    if (norm < 0) norm = 0;
    else if (norm > 1) norm = 1;
    out[p] = norm;
  }
}

/**
 * Filled-line spectrum. When `active` is true this mirrors the oscilloscope hot
 * path: a frame loop pulls native data and updates the Skia view imperatively.
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
  tiltDbPerOctave = TILT_DB_PER_OCT,
  color: colorProp,
  lineWidth = 2,
  lineOpacity = 1,
  fillOpacity = 1,
  glow = false,
  glowOpacity = 0.18,
  edgeFade = false,
  edgeFadeWidth = 28,
}: SpectrumCurveProps) {
  const themeColors = useColors();
  const color = colorProp ?? themeColors.accent;
  const reduceMotion = useReducedMotion();
  const viewRef = useRef<SkiaPictureView | null>(null);
  // Last live curve, kept across effect re-runs so deactivation can decay it
  // to the floor instead of freezing the final frame.
  const lastLiveValuesRef = useRef<Float32Array | null>(null);
  // Half a point per pixel, capped: the quadTo midpoint smoothing makes denser
  // sampling visually indistinguishable while doubling per-frame path cost.
  const activePointCount = Math.min(160, Math.max(96, Math.floor(width / 2)));
  const resolvedPointCount = pointCount ?? values?.length ?? (active ? activePointCount : DEFAULT_POINTS);
  const staticValues = useMemo(
    () => values ?? new Float32Array(resolvedPointCount),
    [resolvedPointCount, values]
  );
  const initialPicture = useMemo(
    () =>
      buildPicture(
        staticValues,
        Math.max(1, width),
        Math.max(1, height),
        color,
        lineWidth,
        lineOpacity,
        fillOpacity,
        glow,
        glowOpacity,
        edgeFade,
        edgeFadeWidth
      ),
    [
      color,
      edgeFade,
      edgeFadeWidth,
      fillOpacity,
      glow,
      glowOpacity,
      height,
      lineOpacity,
      lineWidth,
      staticValues,
      width,
    ]
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
    if (!view || !api || width <= 0 || height <= 0 || resolvedPointCount < 2) return;
    const priorLive = lastLiveValuesRef.current;
    // Static usage (values prop, never went live): leave the initial picture.
    if (!active && !priorLive) return;

    let mounted = true;
    let raf = 0;
    let lastAnalysis = 0;
    let lastDraw = 0;
    let hasNewFrame = false;
    const drawThreshold = frameMs > 0 ? Math.max(0, frameMs - 0.5) : 0;
    const analysisMs = analysisFrameMs ?? frameMs;
    const analysisThreshold = analysisMs > 0 ? Math.max(0, analysisMs - 0.5) : 0;
    const renderValues =
      !active && priorLive && priorLive.length === resolvedPointCount
        ? priorLive
        : new Float32Array(resolvedPointCount);
    const pointOptions = { dbMin, dbMax, tiltDbPerOctave };

    // Paints, shaders, and paths live for the whole effect run: allocating them
    // (and the gradient shaders) per frame was measurable GC/JSI churn at 60fps.
    const fade = edgeFade && edgeFadeWidth > 0 ? { width, fadeWidth: edgeFadeWidth } : null;
    const strokePaint = makeStrokePaint(color, lineWidth, lineOpacity);
    const glowPaint = glow ? makeStrokePaint(color, lineWidth * 3, glowOpacity) : null;
    const effectResources: SkiaDisposable[] = [strokePaint];
    if (glowPaint) effectResources.push(glowPaint);
    if (fade) {
      const strokeShader = makeFadedStrokeShader(color, lineOpacity, width, edgeFadeWidth);
      effectResources.push(strokeShader);
      strokePaint.setShader(strokeShader);
      if (glowPaint) {
        const glowShader = makeFadedStrokeShader(color, glowOpacity, width, edgeFadeWidth);
        effectResources.push(glowShader);
        glowPaint.setShader(glowShader);
      }
    }
    const fillResources = makeFillPaint(color, height, fillOpacity, fade);
    const fillPaint = fillResources.paint;
    effectResources.push(fillPaint, ...fillResources.shaders);
    const bounds = Skia.XYWHRect(0, 0, width, height);
    const linePath = Skia.Path.Make();
    const fillPath = Skia.Path.Make();
    effectResources.push(linePath, fillPath);
    let currentPicture: SkPicture | null = null;

    const draw = () => {
      writePaths(renderValues, width, height, lineWidth, linePath, fillPath);
      const recorder = Skia.PictureRecorder();
      const canvas = recorder.beginRecording(bounds);
      canvas.drawPath(fillPath, fillPaint);
      if (glowPaint) canvas.drawPath(linePath, glowPaint);
      canvas.drawPath(linePath, strokePaint);
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
      // Deactivation: decay the last live curve to the floor, then rest.
      lastLiveValuesRef.current = null;
      let peak = 0;
      for (let i = 0; i < renderValues.length; i++) {
        if (renderValues[i] > peak) peak = renderValues[i];
      }
      if (reduceMotion || peak < REST_EPSILON) {
        renderValues.fill(0);
        draw();
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
        for (let i = 0; i < renderValues.length; i++) {
          const v = renderValues[i] * DECAY_PER_FRAME;
          renderValues[i] = v;
          if (v > max) max = v;
        }
        if (max < REST_EPSILON) {
          renderValues.fill(0);
          draw();
          return;
        }
        draw();
        raf = requestAnimationFrame(decayTick);
      };
      raf = requestAnimationFrame(decayTick);
      return cleanup;
    }

    lastLiveValuesRef.current = renderValues;
    renderValues.fill(0);
    draw();

    const tick = (t: number) => {
      if (!mounted) return;
      raf = requestAnimationFrame(tick);
      if (analysisThreshold <= 0 || t - lastAnalysis >= analysisThreshold) {
        lastAnalysis = t;
        const got =
          source === 'post'
            ? AstraScope.getSpectrumFramePostEq(spectrumBins, smoothing)
            : AstraScope.getSpectrumFrame(spectrumBins, smoothing);
        if (got > 0) {
          writeSpectrumPoints(spectrumBins, renderValues, pointOptions);
          hasNewFrame = true;
        }
      }

      if (!hasNewFrame || (drawThreshold > 0 && t - lastDraw < drawThreshold)) return;
      lastDraw = t;
      hasNewFrame = false;
      draw();
    };

    raf = requestAnimationFrame(tick);
    return cleanup;
  }, [
    active,
    analysisFrameMs,
    color,
    dbMax,
    dbMin,
    edgeFade,
    edgeFadeWidth,
    fillOpacity,
    frameMs,
    glow,
    glowOpacity,
    height,
    lineOpacity,
    lineWidth,
    reduceMotion,
    resolvedPointCount,
    source,
    smoothing,
    tiltDbPerOctave,
    width,
  ]);

  if (width <= 0 || height <= 0) return null;
  return <SkiaPictureView ref={viewRef} picture={initialPicture} style={{ width, height }} />;
}

export default SpectrumCurve;

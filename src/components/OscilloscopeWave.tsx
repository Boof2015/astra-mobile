import {
  useEffect,
  useMemo,
  useRef
} from 'react';
import {
  PaintStyle,
  Skia,
  SkiaPictureView,
  StrokeCap,
  StrokeJoin,
  type SkPicture
} from '@shopify/react-native-skia';
import { AstraScope, OSCILLOSCOPE_POINTS } from '../../modules/astra-scope';
import { useScopeStore } from '@/scope/scopeStore';
import { DEFAULT_OSC_GAIN } from '@/scope/oscilloscopeGain';
import { colors } from '@/theme';

interface OscilloscopeWaveProps {
  active: boolean;
  width: number;
  height: number;
  color?: string;
  lineWidth?: number;
  glow?: boolean;
  edgeFade?: boolean;
}

type SkiaViewApiShape = {
  setJsiProperty: <T>(nativeId: number, name: string, value: T) => void;
  requestRedraw: (nativeId: number) => void;
};

const values = new Float32Array(OSCILLOSCOPE_POINTS);

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

function buildPicture(
  samples: Float32Array,
  sampleCount: number,
  width: number,
  height: number,
  color: string,
  lineWidth: number,
  glow: boolean,
  gain: number
): SkPicture {
  const recorder = Skia.PictureRecorder();
  const canvas = recorder.beginRecording(Skia.XYWHRect(0, 0, width, height));
  const n = Math.min(sampleCount, samples.length);

  if (n >= 2 && width > 0 && height > 0) {
    const path = Skia.Path.Make();
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

    if (glow) {
      canvas.drawPath(path, makeStrokePaint(color, lineWidth * 3, 0.18));
    }
    canvas.drawPath(path, makeStrokePaint(color, lineWidth));
  }

  return recorder.finishRecordingAsPicture();
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
  color = colors.accent,
  lineWidth = 2,
  glow = false,
  edgeFade: _edgeFade = false,
}: OscilloscopeWaveProps) {
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
        DEFAULT_OSC_GAIN
      ),
    [color, glow, height, lineWidth, width]
  );

  useEffect(() => {
    const view = viewRef.current;
    const api = skiaViewApi();
    if (!view || !api || width <= 0 || height <= 0) return;

    let mounted = true;
    let raf = 0;

    const draw = (sampleCount: number) => {
      const gain = useScopeStore.getState().oscGain;
      const picture = buildPicture(values, sampleCount, width, height, color, lineWidth, glow, gain);
      api.setJsiProperty(view.nativeId, 'picture', picture);
      api.requestRedraw(view.nativeId);
    };

    values.fill(0);
    draw(values.length);

    const tick = () => {
      if (!mounted) return;
      raf = requestAnimationFrame(tick);
      if (!active) return;

      const n = AstraScope.getOscilloscopeFrame(values);
      if (n > 0) draw(n);
    };

    raf = requestAnimationFrame(tick);
    return () => {
      mounted = false;
      cancelAnimationFrame(raf);
    };
  }, [active, color, glow, height, lineWidth, width]);

  if (width <= 0 || height <= 0) return null;
  return <SkiaPictureView ref={viewRef} picture={initialPicture} style={{ width, height }} />;
}

export default OscilloscopeWave;

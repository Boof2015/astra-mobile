import { useEffect, useEffectEvent } from 'react';
import {
  Canvas,
  LinearGradient,
  RadialGradient,
  Rect,
  vec,
} from '@shopify/react-native-skia';
import Animated, {
  useAnimatedStyle,
  useDerivedValue,
  useFrameCallback,
  useReducedMotion,
  useSharedValue,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import { useColors } from '@/theme/themed';
import { FIELD_SIZE, type ArtworkField } from '@/theme/artworkField';
import { fieldStrength } from '@/theme/fieldContrast';

/**
 * Living gradient: the cover's colors as three soft fields drifting slowly
 * behind now-playing. Pure color, never the art itself (full-bleed art was
 * rejected for the widget and for this screen). Draw-only: an absolute,
 * non-interactive first child, so it can never move a control.
 *
 * The drift runs on the UI thread, eases to rest on pause, and stops entirely
 * while the player is off screen or backgrounded.
 *
 * The field is composited at a fixed strength as a whole. Blending each blob
 * on its own (additively, at first) let overlaps stack until a bright cover
 * turned the field pale lavender and swallowed the quieter text (device pass,
 * 2026-10-02). As one surface, the brightest the field can get is known from
 * its colors, which is what `paletteOverField` lifts the text tokens against.
 *
 * Cost (Perfetto on an S22 Ultra, 2026-10-02): an animated Skia canvas renders
 * and presents from the UI thread on every frame it changes. At full screen,
 * 120Hz, with an offscreen layer, this one competed with every animation on the
 * screen. So: the strength is the view's opacity (the compositor applies it;
 * every element here is a blend toward the background, so view alpha gives the
 * same pixels a layer did), the canvas draws at 1/RENDER_SCALE resolution and
 * is scaled up (the blobs are soft, the upscale is invisible), and the drift
 * steps at DRIFT_STEP_MS rather than every frame.
 */

/** Radians of drift per second at full speed; ~25-40s per blob orbit. */
const DRIFT_RATE = 0.26;
/** How long the drift takes to come to rest on pause, and to pick up on play. */
const SETTLE_MS = 900;
/** Track-to-track color change. */
const CROSSFADE_MS = 450;
/** The canvas draws at 1/RENDER_SCALE of the screen in each dimension. */
const RENDER_SCALE = 4;
/** Drift redraw interval: ~30Hz is smooth for a blob that takes ~30s to orbit. */
const DRIFT_STEP_MS = 33;
/**
 * The controls sit in the lower half; the field dissolves back into the theme
 * background there so text contrast is the theme's own.
 */
const FADE_STOPS = [0, 0.46, 0.8, 1];
const FADE_MID_ALPHA = 'b8';

/** Lissajous orbit per blob, as fractions of the screen. */
const BLOBS = [
  { ox: 0.3, oy: 0.22, ax: 0.9, ay: 0.7, r: 0.95, seed: 0 },
  { ox: 0.72, oy: 0.34, ax: 0.6, ay: 1.1, r: 0.85, seed: 1 },
  { ox: 0.48, oy: 0.55, ax: 1.3, ay: 0.5, r: 0.75, seed: 2 },
] as const;

function hexToRgbTriplet(hex: string): [number, number, number] {
  const value = parseInt(hex.slice(1, 7), 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

interface NowPlayingBackdropProps {
  /** The cover's field (resolved by the overlay, which also derives text contrast from it); null clears it. */
  field: ArtworkField | null;
  /** Player on screen and app foregrounded. */
  active: boolean;
  playing: boolean;
  /** The content node's full size (the window, or the dock column). */
  width: number;
  height: number;
  isDark: boolean;
}

export function NowPlayingBackdrop({
  field,
  active,
  playing,
  width,
  height,
  isDark,
}: NowPlayingBackdropProps) {
  const colors = useColors();
  const reduceMotion = useReducedMotion();

  const phase = useSharedValue(0);
  const speed = useSharedValue(playing ? 1 : 0);
  const fromRgb = useSharedValue<number[]>(new Array(FIELD_SIZE * 3).fill(0));
  const toRgb = useSharedValue<number[]>(new Array(FIELD_SIZE * 3).fill(0));
  const fade = useSharedValue(1);
  const strength = useSharedValue(0);

  useEffect(() => {
    speed.set(withTiming(playing ? 1 : 0, { duration: SETTLE_MS }));
  }, [playing, speed]);

  const fieldKey = field ? `${field.colors.join()}:${field.neutral}` : null;
  // An effect event so the effect can key on `fieldKey` rather than `field`,
  // whose object identity changes with every resolve, without hiding `field`
  // from the deps (a suppression would drop this component from the compiler).
  const applyField = useEffectEvent(() => {
    if (!field) {
      strength.set(withTiming(0, { duration: CROSSFADE_MS }));
      return;
    }
    // Start from whatever is on screen right now, so a skip mid-fade never jumps.
    const k = fade.get();
    const from = fromRgb.get();
    const to = toRgb.get();
    const shown = from.map((value, index) => value + (to[index] - value) * k);
    const next = field.colors.flatMap(hexToRgbTriplet);
    // First field after nothing was showing: no point fading from black.
    fromRgb.set(strength.get() < 0.01 ? next : shown);
    toRgb.set(next);
    fade.set(0);
    fade.set(withTiming(1, { duration: CROSSFADE_MS }));
    strength.set(withTiming(fieldStrength(isDark, field.neutral), { duration: CROSSFADE_MS }));
  });
  useEffect(() => {
    applyField();
  }, [fieldKey, isDark]);

  const pendingMs = useSharedValue(0);
  const drift = useFrameCallback((frame) => {
    pendingMs.value += frame.timeSincePreviousFrame ?? 0;
    if (pendingMs.value < DRIFT_STEP_MS) return;
    const step = (pendingMs.value / 1000) * DRIFT_RATE * speed.value;
    pendingMs.value = 0;
    // At rest, skip the write: a write is a redraw.
    if (step > 0) phase.value += step;
  }, false);

  useEffect(() => {
    drift.setActive(active && !reduceMotion);
  }, [active, drift, reduceMotion]);

  const strengthStyle = useAnimatedStyle(() => ({ opacity: strength.value }));
  // Canvas units: the whole field at 1/RENDER_SCALE, scaled back up by the view.
  const w = width / RENDER_SCALE;
  const h = height / RENDER_SCALE;

  return (
    // Absolute children of the content node are placed against its outer edge,
    // not inside its padding, so 0/0 already is the true screen corner. (Negative
    // insets pushed the field 20dp off the left and left a bare strip down the
    // right — device pass, 2026-10-02.)
    <Animated.View
      pointerEvents="none"
      style={[{ position: 'absolute', top: 0, left: 0, width, height }, strengthStyle]}
    >
      <Canvas
        style={{
          width: w,
          height: h,
          transform: [{ scale: RENDER_SCALE }],
          transformOrigin: 'top left',
        }}
      >
        <Rect x={0} y={0} width={w} height={h} color={colors.bgPrimary} />
        {BLOBS.map((blob, index) => (
          <Blob
            key={blob.seed}
            index={index}
            width={w}
            height={h}
            phase={phase}
            fade={fade}
            fromRgb={fromRgb}
            toRgb={toRgb}
          />
        ))}
        <Rect x={0} y={0} width={w} height={h}>
          <LinearGradient
            start={vec(0, 0)}
            end={vec(0, h)}
            colors={[
              `${colors.bgPrimary}00`,
              `${colors.bgPrimary}00`,
              `${colors.bgPrimary}${FADE_MID_ALPHA}`,
              colors.bgPrimary,
            ]}
            positions={FADE_STOPS}
          />
        </Rect>
      </Canvas>
    </Animated.View>
  );
}

interface BlobProps {
  index: number;
  width: number;
  height: number;
  phase: SharedValue<number>;
  fade: SharedValue<number>;
  fromRgb: SharedValue<number[]>;
  toRgb: SharedValue<number[]>;
}

function Blob({ index, width, height, phase, fade, fromRgb, toRgb }: BlobProps) {
  const blob = BLOBS[index];
  const center = useDerivedValue(() => {
    const p = phase.value;
    return {
      x: (blob.ox + 0.22 * Math.sin(p * blob.ax + blob.seed * 2.1)) * width,
      y: (blob.oy + 0.12 * Math.cos(p * blob.ay + blob.seed * 1.3)) * height,
    };
  }, [width, height]);
  const gradient = useDerivedValue(() => {
    const k = fade.value;
    const from = fromRgb.value;
    const to = toRgb.value;
    const o = index * 3;
    const r = Math.round(from[o] + (to[o] - from[o]) * k);
    const g = Math.round(from[o + 1] + (to[o + 1] - from[o + 1]) * k);
    const b = Math.round(from[o + 2] + (to[o + 2] - from[o + 2]) * k);
    return [`rgba(${r},${g},${b},1)`, `rgba(${r},${g},${b},0)`];
  });
  return (
    <Rect x={0} y={0} width={width} height={height}>
      <RadialGradient c={center} r={blob.r * width} colors={gradient} />
    </Rect>
  );
}

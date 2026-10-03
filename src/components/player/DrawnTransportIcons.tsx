import { useEffect, useRef, type ReactNode } from 'react';
import {
  Canvas,
  DashPathEffect,
  Group,
  Path,
  Skia,
} from '@shopify/react-native-skia';
import {
  Easing,
  ReduceMotion,
  useDerivedValue,
  useSharedValue,
  withDelay,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';

/**
 * Shuffle, repeat and play/pause drawn as paths instead of Ionicons glyphs, so
 * their parts can move: a glyph is one font character with nothing inside it
 * to animate. Picked in the Look Lab (2026-10-02):
 *
 *   shuffle  Fork  — the arrowheads stay put while the tails trade places;
 *                    off is two straight lanes, on is the crossed glyph
 *   repeat   Flow  — both arrows travel half a lap around the loop (on and
 *                    one only; off fades without moving)
 *   play     Morph — the triangle's halves square off into the two bars
 *
 * Geometry is in a 24-unit box. Every helper a worklet calls is itself a
 * worklet declared above its caller (see workletOrder.test.mts).
 */

/** Line weight in box units. Ionicons' outline glyphs sit near 1.5; the transport reads better a touch heavier. */
const STROKE = 1.75;
const STRUCTURAL = Easing.bezier(0.22, 1, 0.36, 1);
const COLOR_FADE = { duration: 160, easing: Easing.out(Easing.cubic), reduceMotion: ReduceMotion.System } as const;

function hexTriplet(hex: string): [number, number, number] {
  const value = parseInt(hex.slice(1, 7), 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

function mixRgb(a: number[], b: number[], t: number): string {
  'worklet';
  const r = Math.round(a[0] + (b[0] - a[0]) * t);
  const g = Math.round(a[1] + (b[1] - a[1]) * t);
  const bl = Math.round(a[2] + (b[2] - a[2]) * t);
  return `rgb(${r},${g},${bl})`;
}

/** Off → on color, eased on the UI thread (icon fonts can't do this; paths can). */
function useStateColor(on: boolean, inactive: string, active: string): SharedValue<string> {
  const progress = useSharedValue(on ? 1 : 0);
  useEffect(() => {
    progress.value = withTiming(on ? 1 : 0, COLOR_FADE);
  }, [on, progress]);
  const from = hexTriplet(inactive);
  const to = hexTriplet(active);
  return useDerivedValue(() => mixRgb(from, to, progress.value), [inactive, active]);
}

function IconCanvas({ size, children }: { size: number; children: ReactNode }) {
  return (
    <Canvas style={{ width: size, height: size }} pointerEvents="none">
      <Group transform={[{ scale: size / 24 }]}>{children}</Group>
    </Canvas>
  );
}

// ── Shuffle: Fork ────────────────────────────────────────

const FORK_MS = 440;
const SHUFFLE_HEADS = (() => {
  const path = Skia.Path.Make();
  path.moveTo(17.7, 4.2);
  path.lineTo(20.5, 7);
  path.lineTo(17.7, 9.8);
  path.moveTo(17.7, 14.2);
  path.lineTo(20.5, 17);
  path.lineTo(17.7, 19.8);
  return path;
})();

/** One strand: a tail at y0 on the left, an arrowhead end at y1 on the right. */
function shuffleStrand(y0: number, y1: number) {
  'worklet';
  const path = Skia.Path.Make();
  path.moveTo(3, y0);
  path.lineTo(5.5, y0);
  path.cubicTo(11, y0, 12, y1, 17.5, y1);
  path.lineTo(20, y1);
  return path;
}

export function ShuffleForkIcon({
  on,
  size,
  inactiveColor,
  activeColor,
}: {
  on: boolean;
  size: number;
  inactiveColor: string;
  activeColor: string;
}) {
  const t = useSharedValue(on ? 1 : 0);
  useEffect(() => {
    t.value = withTiming(on ? 1 : 0, {
      duration: FORK_MS,
      easing: Easing.inOut(Easing.cubic),
      reduceMotion: ReduceMotion.System,
    });
  }, [on, t]);
  const color = useStateColor(on, inactiveColor, activeColor);
  // The heads never move; the tails swap through the middle, which reads as a
  // fork at the halfway point instead of two arrows coming loose.
  const upper = useDerivedValue(() => shuffleStrand(7 + 10 * t.value, 7));
  const lower = useDerivedValue(() => shuffleStrand(17 - 10 * t.value, 17));
  const stroke = { style: 'stroke', strokeWidth: STROKE, strokeCap: 'round', strokeJoin: 'round', color } as const;
  return (
    <IconCanvas size={size}>
      <Path path={upper} {...stroke} />
      <Path path={lower} {...stroke} />
      <Path path={SHUFFLE_HEADS} {...stroke} />
    </IconCanvas>
  );
}

// ── Repeat: Flow ─────────────────────────────────────────

/**
 * The loop is one closed path carrying two dashes, each ending in an
 * arrowhead. Sliding the dashes half a lap maps the icon onto itself, which is
 * what lets the arrows chase each other and still land on the resting glyph.
 */
const LOOP_SVG = 'M20 5.6 V14 A4.4 4.4 0 0 1 15.6 18.4 H4 V10 A4.4 4.4 0 0 1 8.4 5.6 Z';
const LOOP = Skia.Path.MakeFromSVGString(LOOP_SVG) ?? Skia.Path.Make();
const ARC = (Math.PI / 2) * 4.4;
const LOOP_LENGTH = 2 * (8.4 + 11.6) + 2 * ARC;
const HALF_LAP = LOOP_LENGTH / 2;
/** Where the lower dash starts (the gap below the upper arrowhead). */
const DASH_START = 7.2;
const DASH_LENGTH = HALF_LAP - DASH_START;
const ONE = (() => {
  const path = Skia.Path.Make();
  path.moveTo(10.5, 10.3);
  path.lineTo(12.4, 8.9);
  path.lineTo(12.4, 15.1);
  return path;
})();
const REPEAT_HEAD = (() => {
  const path = Skia.Path.Make();
  path.moveTo(-3, -2.8);
  path.lineTo(0, 0);
  path.lineTo(-3, 2.8);
  return path;
})();

/**
 * Point and travel direction at distance `d` along the loop, analytically (it
 * is four straight runs and two quarter arcs), so moving heads cost no path
 * measuring per frame. A distance on a segment boundary takes the incoming
 * segment's direction, so a head sitting on a corner points the way it came.
 */
function loopPoint(d: number): { x: number; y: number; angle: number } {
  'worklet';
  let s = d % LOOP_LENGTH;
  if (s <= 0) s += LOOP_LENGTH;
  if (s <= 8.4) return { x: 20, y: 5.6 + s, angle: 90 };
  s -= 8.4;
  if (s <= ARC) {
    const theta = s / 4.4;
    return { x: 15.6 + 4.4 * Math.cos(theta), y: 14 + 4.4 * Math.sin(theta), angle: 90 + (theta * 180) / Math.PI };
  }
  s -= ARC;
  if (s <= 11.6) return { x: 15.6 - s, y: 18.4, angle: 180 };
  s -= 11.6;
  if (s <= 8.4) return { x: 4, y: 18.4 - s, angle: 270 };
  s -= 8.4;
  if (s <= ARC) {
    const theta = Math.PI + s / 4.4;
    return { x: 8.4 + 4.4 * Math.cos(theta), y: 10 + 4.4 * Math.sin(theta), angle: 90 + (theta * 180) / Math.PI };
  }
  s -= ARC;
  return { x: 8.4 + s, y: 5.6, angle: 0 };
}

function headTransform(d: number) {
  'worklet';
  const p = loopPoint(d);
  return [{ translateX: p.x }, { translateY: p.y }, { rotate: (p.angle * Math.PI) / 180 }];
}

export type RepeatIconMode = 'none' | 'all' | 'one';

export function RepeatFlowIcon({
  mode,
  size,
  inactiveColor,
  activeColor,
}: {
  mode: RepeatIconMode;
  size: number;
  inactiveColor: string;
  activeColor: string;
}) {
  const shift = useSharedValue(0);
  const one = useSharedValue(mode === 'one' ? 1 : 0);
  const previous = useRef(mode);

  useEffect(() => {
    const from = previous.current;
    previous.current = mode;
    if (from === mode) return;
    // On and one flow forward. Half a lap lands on the same glyph, so the clock
    // resets to zero invisibly once it gets there. Off does not travel: flowing
    // backward dragged the arrowheads around the corners tail-first (device
    // pass, 2026-10-02) — it just fades to grey.
    if (mode !== 'none') {
      shift.value = 0;
      shift.value = withTiming(
        HALF_LAP,
        {
          duration: mode === 'all' ? 600 : 420,
          easing: STRUCTURAL,
          reduceMotion: ReduceMotion.System,
        },
        (finished) => {
          if (finished) shift.value = 0;
        }
      );
    }
    if (mode === 'one') {
      one.value = withDelay(
        140,
        withTiming(1, { duration: 300, easing: Easing.out(Easing.cubic), reduceMotion: ReduceMotion.System })
      );
    } else if (from === 'one') {
      one.value = withTiming(0, { duration: 220, easing: Easing.inOut(Easing.cubic), reduceMotion: ReduceMotion.System });
    }
  }, [mode, one, shift]);

  const color = useStateColor(mode !== 'none', inactiveColor, activeColor);
  // Skia's dash phase is an offset into the pattern, like SVG's dashoffset.
  const phase = useDerivedValue(() => {
    const offset = -(DASH_START + shift.value);
    return ((offset % HALF_LAP) + HALF_LAP) % HALF_LAP;
  });
  const lowerHead = useDerivedValue(() => headTransform(DASH_START + DASH_LENGTH + shift.value));
  const upperHead = useDerivedValue(() => headTransform(DASH_START + DASH_LENGTH + HALF_LAP + shift.value));
  // A trimmed stroke's last sliver is a round cap, which reads as a stray dot;
  // fade the 1 over the first and last stretch of its trim so it never shows.
  const oneOpacity = useDerivedValue(() => Math.min(1, one.value * 3));
  const stroke = { style: 'stroke', strokeWidth: STROKE, strokeCap: 'round', strokeJoin: 'round', color } as const;

  return (
    <IconCanvas size={size}>
      <Path path={LOOP} {...stroke}>
        <DashPathEffect intervals={[DASH_LENGTH, HALF_LAP - DASH_LENGTH]} phase={phase} />
      </Path>
      <Group transform={lowerHead}>
        <Path path={REPEAT_HEAD} {...stroke} />
      </Group>
      <Group transform={upperHead}>
        <Path path={REPEAT_HEAD} {...stroke} />
      </Group>
      <Path path={ONE} {...stroke} strokeWidth={STROKE * 0.9} start={0} end={one} opacity={oneOpacity} />
    </IconCanvas>
  );
}

// ── Play / pause: Morph ──────────────────────────────────

const MORPH_MS = 240;
// Two quads: the triangle's halves, or the two bars. Vertex order matches, so
// each corner travels to its partner. The bars are inset by half the stroke
// that rounds their corners.
const TRI_L = [9, 6.4, 13.7, 9.2, 13.7, 14.8, 9, 17.6];
const TRI_R = [13.7, 9.2, 18.4, 12, 18.4, 12, 13.7, 14.8];
const BAR_L = [7.1, 6.1, 9.7, 6.1, 9.7, 17.9, 7.1, 17.9];
const BAR_R = [14.3, 6.1, 16.9, 6.1, 16.9, 17.9, 14.3, 17.9];

function morphQuad(a: number[], b: number[], t: number) {
  'worklet';
  const path = Skia.Path.Make();
  for (let i = 0; i < 8; i += 2) {
    const x = a[i] + (b[i] - a[i]) * t;
    const y = a[i + 1] + (b[i + 1] - a[i + 1]) * t;
    if (i === 0) path.moveTo(x, y);
    else path.lineTo(x, y);
  }
  path.close();
  return path;
}

export function PlayPauseMorphIcon({
  playing,
  size,
  color,
}: {
  playing: boolean;
  size: number;
  color: string;
}) {
  const t = useSharedValue(playing ? 1 : 0);
  useEffect(() => {
    t.value = withTiming(playing ? 1 : 0, {
      duration: MORPH_MS,
      easing: Easing.inOut(Easing.cubic),
      reduceMotion: ReduceMotion.System,
    });
  }, [playing, t]);
  const left = useDerivedValue(() => morphQuad(TRI_L, BAR_L, t.value));
  const right = useDerivedValue(() => morphQuad(TRI_R, BAR_R, t.value));
  // Fill plus a thin round-joined stroke of the same color softens the corners
  // the way the glyphs' rounded rects did.
  const soft = { style: 'stroke', strokeWidth: 1.2, strokeJoin: 'round', color } as const;
  return (
    <IconCanvas size={size}>
      <Path path={left} color={color} />
      <Path path={left} {...soft} />
      <Path path={right} color={color} />
      <Path path={right} {...soft} />
    </IconCanvas>
  );
}

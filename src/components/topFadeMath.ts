/**
 * The gradient band that dissolves content on its way behind the status bar.
 *
 * A screen that bleeds under the status bar has its scroll frame reach y=0, so
 * a heading riding up gets clipped mid-glyph at the top of the window. Clipping
 * is what "cut off in the void" was: the letters do not end, they stop.
 *
 * The band's job is to make them *end*, and three things have to be true at
 * once:
 *
 * 1. Nothing legible survives where the clock and icons are. Without a blur to
 *    destroy the letterforms, readable text up there reads as two things
 *    overlapping rather than as depth — so the strip stays effectively solid
 *    through `SOLID_THROUGH`, and the visible dissolve happens below it.
 * 2. The dissolve gets real length to happen over. A short band was the first
 *    attempt and it failed the same way the clipping did: the fade happened
 *    over so little distance that content still read as meeting a line.
 * 3. It has no crease anywhere. This is the subtle one. The alphas below are
 *    *control points*, and joining them with straight lines puts a derivative
 *    discontinuity at every one of them — which the eye picks up as a Mach
 *    band, a visible "gradient line" across the middle of the fade. So the
 *    curve through them is a monotone cubic, sampled densely enough that what
 *    Skia finally interpolates has no corner left in it.
 *
 * The control points are anchored to the status bar's bottom edge rather than
 * set in dp, because the strip is 24dp on one device and 48dp on the next: the
 * solid part always covers exactly the bar, whatever it measures, while the
 * tail stays a constant length in dp because the content it fades is a constant
 * size.
 */

/** One gradient stop: `at` is a 0..1 fraction of the band's height. */
export interface TopFadeStop {
  at: number;
  alpha: number;
}

export interface TopFadeBand {
  height: number;
  /** Where the status bar's bottom edge falls, as a fraction of `height`. */
  barAt: number;
  stops: TopFadeStop[];
}

/**
 * Strength at the very top of the window. Deliberately short of 1 — a whisper
 * of content still shows through behind the clock, which is the difference
 * between content passing behind the status bar and content ending at a slab.
 * Same reasoning, and nearly the same figure, as `MiniPlayerScrim`'s.
 */
const MAX_ALPHA = 0.95;

/**
 * How far below the status bar the band ends, in dp.
 *
 * Both ends of the fade track the strip, and it took two wrong answers to get
 * here. Every screen positions its content at `insets.top` plus its own margin,
 * so a heading's resting distance below the bar is the same on every phone
 * while the bar itself is anywhere from ~28dp to ~52dp. Anchoring only the
 * *start* to the strip and giving the ramp a fixed length held the slope
 * perfectly constant but slid content along the curve: the top of a resting
 * title was washed 23% on a short-strip phone and 13% on a tall-strip one,
 * which is the difference between looking dimmed and looking clean.
 *
 * The other wrong answer was hanging the interior points off the bar's bottom
 * edge, which made a single segment proportional to the strip and compressed
 * the whole ramp into ~11dp on a short one — a hard line again. So the interior
 * points are fractions of the *span* between the two anchors, and the span
 * varies by about a sixth across the range instead of doubling.
 *
 * This is the number to turn if the fade feels abrupt (raise) or if resting
 * content near the top looks dimmed (lower).
 */
const TAIL = 58;

/**
 * How far down the strip the wash stays effectively solid, as a fraction of it
 * — about the middle of the clock and icon row.
 *
 * This is the smoothness knob, and it trades against the icons. Holding solid
 * all the way to the bottom of the icons (0.7) forces the entire visible
 * dissolve into the ~14dp below them, and that steepness alone reads as a line
 * even with no crease left in it. Releasing at the icons' centre instead buys
 * the ramp half again as much room; the cost is that content is a ~20% ghost at
 * their lower edge, which is well short of legible.
 */
const SOLID_THROUGH = 0.55;

/**
 * Alpha at `SOLID_THROUGH`. Past roughly this figure the wash is
 * indistinguishable from solid `bgPrimary`, so this is the point where the
 * gradient stops being background and starts being visible.
 */
const SOLID_ALPHA = 0.88;

/**
 * The dissolve's shape, as fractions of the span between the two anchors.
 *
 * Convex: it sheds most of its strength in the first half and then spends the
 * rest of its length creeping to zero, which is what keeps a band this long
 * from reading as a deliberate dimmed strip (the mistake `MiniPlayerScrim`
 * records making at the other end of the screen).
 *
 * The first point is placed so that on a typical phone the status bar's bottom
 * edge lands at about half alpha — content clearing the bar is visibly still
 * dissolving rather than snapping back to full strength.
 */
const DISSOLVE_POINTS: readonly (readonly [of: number, alpha: number])[] = [
  [0.27, 0.52],
  [0.52, 0.15],
  [0.72, 0.05],
];

/**
 * How many stops the curve is flattened into.
 *
 * Skia interpolates linearly between stops, so this is what decides whether the
 * cubic survives as a smooth ramp or comes back as a polyline. Forty across a
 * ~110dp band puts the remaining corners under 3dp apart, well below where a
 * Mach band forms.
 */
const SAMPLES = 40;

/**
 * The largest share of the window the band may occupy before the screen should
 * stop bleeding altogether.
 *
 * `insets.top` is not zero in landscape — Android keeps the status bar up, and
 * `shellLayout` already budgets for it — so without this a ~95dp band lands in
 * a ~360dp-tall window and washes a quarter of the screen.
 *
 * Refusing beats compressing. Squeezing the curve into a short window
 * re-steepens it into exactly the hard line the shape exists to avoid, and the
 * honest answer for a window with no height to spare is not to bleed at all:
 * `Screen` keeps paying its own inset and content stops below the bar, the same
 * as on every screen that never opted in. There is no cut to soften, because
 * there is no bleed.
 *
 * At 0.18 the cutoff lands near a 590dp window, which is within a few dp of
 * `RAIL_MAX_WINDOW_HEIGHT` — the point where the shell independently decided
 * height was scarce. Phones bleed in portrait and not in landscape; tablets
 * bleed either way.
 */
const MAX_WINDOW_SHARE = 0.18;

/**
 * Tangents for a monotone cubic (Fritsch–Carlson) through the control points.
 *
 * Plain Catmull-Rom would be smooth but can overshoot, and an alpha that dips
 * below zero or bulges above the point above it would show as a bright or dark
 * ring inside the fade. This limiter is what rules that out.
 */
function monotoneTangents(xs: number[], ys: number[]): number[] {
  const n = xs.length;
  const secants: number[] = [];
  for (let i = 0; i < n - 1; i += 1) {
    secants.push((ys[i + 1]! - ys[i]!) / (xs[i + 1]! - xs[i]!));
  }

  const tangents: number[] = [secants[0]!];
  for (let i = 1; i < n - 1; i += 1) {
    const previous = secants[i - 1]!;
    const next = secants[i]!;
    tangents.push(previous * next <= 0 ? 0 : (previous + next) / 2);
  }
  tangents.push(secants[n - 2]!);

  for (let i = 0; i < n - 1; i += 1) {
    const secant = secants[i]!;
    if (secant === 0) {
      tangents[i] = 0;
      tangents[i + 1] = 0;
      continue;
    }
    const a = tangents[i]! / secant;
    const b = tangents[i + 1]! / secant;
    const magnitude = a * a + b * b;
    if (magnitude > 9) {
      const scale = 3 / Math.sqrt(magnitude);
      tangents[i] = scale * a * secant;
      tangents[i + 1] = scale * b * secant;
    }
  }

  return tangents;
}

/** Cubic Hermite evaluation on the span containing `x`. */
function interpolate(xs: number[], ys: number[], tangents: number[], x: number): number {
  let span = xs.length - 2;
  for (let i = 0; i < xs.length - 1; i += 1) {
    if (x <= xs[i + 1]!) {
      span = i;
      break;
    }
  }

  const x0 = xs[span]!;
  const x1 = xs[span + 1]!;
  const h = x1 - x0;
  const t = (x - x0) / h;
  const t2 = t * t;
  const t3 = t2 * t;

  return (
    ys[span]! * (2 * t3 - 3 * t2 + 1) +
    h * tangents[span]! * (t3 - 2 * t2 + t) +
    ys[span + 1]! * (-2 * t3 + 3 * t2) +
    h * tangents[span + 1]! * (t3 - t2)
  );
}

/**
 * The band for a given window, or null when this window should not bleed.
 *
 * Null is a decision, not just a rendering skip: a screen must consult this
 * before dropping its top inset, because bleeding without a fade is the hard
 * clip the whole thing exists to remove. Two windows get it — one with no top
 * inset at all (nothing for content to disappear into) and one too short to
 * spend `MAX_WINDOW_SHARE` of itself on the fade.
 */
export function topFadeBand(insetTop: number, windowHeight: number): TopFadeBand | null {
  if (insetTop <= 0) return null;

  // The two anchors, both measured from the strip: the wash releases part-way
  // down the icons, and the band ends a fixed distance below the bar — where
  // resting content sits, on every device.
  const solidEnd = insetTop * SOLID_THROUGH;
  const height = insetTop + TAIL;
  const span = height - solidEnd;
  if (height > windowHeight * MAX_WINDOW_SHARE) return null;

  const control: [at: number, alpha: number][] = [
    [0, MAX_ALPHA],
    [solidEnd, SOLID_ALPHA],
    ...DISSOLVE_POINTS.map(([of, alpha]): [number, number] => [solidEnd + span * of, alpha]),
    [height, 0],
  ];

  const xs = control.map(([at]) => at / height);
  const ys = control.map(([, alpha]) => alpha);
  const tangents = monotoneTangents(xs, ys);

  const stops: TopFadeStop[] = [];
  for (let i = 0; i <= SAMPLES; i += 1) {
    const at = i / SAMPLES;
    // Clamped because the limiter bounds overshoot but the endpoints still have
    // to land exactly on 1 and 0 for the band to be seamless at both edges.
    stops.push({ at, alpha: Math.min(1, Math.max(0, interpolate(xs, ys, tangents, at))) });
  }

  return { height, barAt: insetTop / height, stops };
}

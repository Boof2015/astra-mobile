import assert from 'node:assert/strict';
import test from 'node:test';
import { topFadeBand } from './topFadeMath.ts';

/** A tall punch-hole phone (S22-ish) and a short-strip one, in dp. */
const TALL_INSET = 48;
const SHORT_INSET = 24;

/** Status bar insets across the real Android range, in dp. */
const REAL_INSETS = [28, 32, 36, 40, 44, 48, 52];

/** Phone in portrait, phone in landscape, tablet — window heights in dp. */
const TALL_WINDOW = 780;
const SHORT_WINDOW = 360;
const TABLET_WINDOW = 1180;

/** Alpha at an arbitrary depth into the band, the way Skia will interpolate it. */
function alphaAt(inset: number, depth: number): number {
  const band = topFadeBand(inset, TALL_WINDOW);
  assert.ok(band);
  const at = depth / band.height;
  const next = band.stops.findIndex((stop) => stop.at >= at);
  if (next <= 0) return band.stops[0]!.alpha;
  const from = band.stops[next - 1]!;
  const to = band.stops[next]!;
  return from.alpha + ((at - from.at) / (to.at - from.at)) * (to.alpha - from.alpha);
}

/** Ratio of the largest value to the smallest — how much a device changes it. */
function spread(values: number[]): number {
  return Math.max(...values) / Math.min(...values);
}

/** Slope in alpha-per-dp between each adjacent pair of stops. */
function slopes(inset: number): number[] {
  const band = topFadeBand(inset, TALL_WINDOW);
  assert.ok(band);
  const out: number[] = [];
  for (let i = 1; i < band.stops.length; i += 1) {
    const from = band.stops[i - 1]!;
    const to = band.stops[i]!;
    out.push((from.alpha - to.alpha) / ((to.at - from.at) * band.height));
  }
  return out;
}

test('does not mount a band when there is no strip to cover', () => {
  // No top inset means content is not disappearing into anything, so a
  // zero-height scrim would be pure cost.
  assert.equal(topFadeBand(0, TALL_WINDOW), null);
  assert.equal(topFadeBand(-1, TALL_WINDOW), null);
});

test('refuses a window with no height to spend on the fade', () => {
  // Android keeps the status bar up in landscape — `insets.top` is not zero
  // there, which `shellLayout` already budgets for — so without this the band
  // would wash a quarter of a phone's landscape window. Refusing beats
  // compressing: a squeezed curve re-steepens into the hard line the shape
  // exists to avoid, and the caller answers by not bleeding at all.
  assert.equal(topFadeBand(TALL_INSET, SHORT_WINDOW), null);
  assert.equal(topFadeBand(SHORT_INSET, SHORT_WINDOW), null);
});

test('bleeds on a phone in portrait and on a tablet either way', () => {
  // The cutoff has to fall between a phone's two orientations, not inside the
  // set of devices that should all behave the same.
  assert.ok(topFadeBand(TALL_INSET, TALL_WINDOW));
  assert.ok(topFadeBand(TALL_INSET, TABLET_WINDOW));
  // A tablet in landscape is still tall enough to be worth it.
  assert.ok(topFadeBand(SHORT_INSET, 800));
});

test('gives a window that does bleed the same band whatever its height', () => {
  // Window height is a gate, not a scale: once a window qualifies, the fade is
  // the same physical size on a phone and on a tablet.
  const phone = topFadeBand(TALL_INSET, TALL_WINDOW);
  const tablet = topFadeBand(TALL_INSET, TABLET_WINDOW);
  assert.ok(phone);
  assert.ok(tablet);
  assert.equal(phone.height, tablet.height);
  assert.deepEqual(phone.stops, tablet.stops);
});

test('runs well past the status bar', () => {
  // The first attempt ended ~12dp below the bar and still read as content
  // meeting a line — the dissolve needs length to happen over.
  const band = topFadeBand(TALL_INSET, TALL_WINDOW);
  assert.ok(band);
  assert.ok(band.height - TALL_INSET >= TALL_INSET);
});

test('anchors the curve to the status bar edge, not to a fixed height', () => {
  // The whole point of computing this: the strip is a different height on every
  // device, and the solid part has to cover exactly it, whatever it measures.
  for (const inset of [SHORT_INSET, TALL_INSET]) {
    const band = topFadeBand(inset, TALL_WINDOW);
    assert.ok(band);
    assert.equal(band.barAt, inset / band.height);
  }
});

test('washes to the background at the top and to nothing at the bottom', () => {
  const band = topFadeBand(TALL_INSET, TALL_WINDOW);
  assert.ok(band);
  const first = band.stops[0]!;
  const last = band.stops[band.stops.length - 1]!;

  assert.equal(first.at, 0);
  assert.equal(last.at, 1);
  // Short of fully opaque on purpose — a whisper of content behind the clock is
  // what makes it read as passing behind rather than stopping at a slab.
  assert.ok(first.alpha > 0.85 && first.alpha < 1);
  assert.equal(last.alpha, 0);
});

test('fades in one direction only, with stops Skia will accept', () => {
  // Skia requires ascending positions; a non-monotonic alpha would read as a
  // band rather than a dissolve, and the monotone limiter exists to guarantee
  // the cubic never overshoots into one.
  for (const inset of REAL_INSETS) {
    const band = topFadeBand(inset, TALL_WINDOW);
    assert.ok(band);
    for (let i = 1; i < band.stops.length; i += 1) {
      const previous = band.stops[i - 1]!;
      const current = band.stops[i]!;
      assert.ok(current.at > previous.at, `positions ascend at inset ${inset}`);
      assert.ok(current.alpha <= previous.alpha, `alpha never rises at inset ${inset}`);
      assert.ok(current.alpha >= 0 && current.alpha <= 1, `alpha stays in range at ${inset}`);
    }
  }
});

test('has no crease anywhere along the ramp', () => {
  // The regression this pins, and the reason the curve is a sampled cubic
  // rather than a handful of stops: straight lines between control points meet
  // at a derivative discontinuity, and the eye reads that as a Mach band — a
  // visible "gradient line" across the middle of the fade. An earlier pass
  // kinked by ~0.026 alpha/dp at a single point, which was plainly visible.
  for (const inset of REAL_INSETS) {
    const ramp = slopes(inset);
    for (let i = 1; i < ramp.length; i += 1) {
      assert.ok(
        Math.abs(ramp[i]! - ramp[i - 1]!) < 0.01,
        `kink of ${Math.abs(ramp[i]! - ramp[i - 1]!).toFixed(4)} alpha/dp at inset ${inset}`
      );
    }
  }
});

test('never falls faster than the eye reads as an edge', () => {
  // Smooth is not enough on its own — a steep enough ramp reads as a line even
  // with no crease in it. This is what `SOLID_THROUGH` is really buying.
  for (const inset of REAL_INSETS) {
    assert.ok(Math.max(...slopes(inset)) < 0.025, `peak slope at inset ${inset}`);
  }
});

test('keeps content behind the clock past the point of being legible', () => {
  // Without a blur to destroy the letterforms, readable text behind the status
  // bar reads as two things overlapping rather than as depth. Solid through the
  // icon row's centre, and still a ghost at its lower edge.
  for (const inset of REAL_INSETS) {
    assert.ok(alphaAt(inset, inset * 0.5) >= 0.85, `clock centre at inset ${inset}`);
    assert.ok(alphaAt(inset, inset * 0.65) >= 0.75, `icon lower edge at inset ${inset}`);
  }
});

test('is still visibly fading where content clears the bar', () => {
  // Half gone at the bar's bottom edge. A wash that finished inside the strip
  // would let glyphs re-sharpen just before they disappeared.
  assert.ok(alphaAt(TALL_INSET, TALL_INSET) > 0.35);
  assert.ok(alphaAt(TALL_INSET, TALL_INSET) < 0.65);
});

test('lays a deliberate light wash over content resting below the bar', () => {
  // A dissolve this long cannot also leave the top of a resting heading
  // untouched, and that is the accepted trade: a soft vignette the content
  // emerges from, not a dimmed strip. Pinned so it can't drift into one.
  const restingTitle = alphaAt(TALL_INSET, TALL_INSET + 24);
  assert.ok(restingTitle > 0.05 && restingTitle < 0.2, `resting wash ${restingTitle.toFixed(3)}`);
});

test('spends its last fifth effectively invisible', () => {
  const band = topFadeBand(TALL_INSET, TALL_WINDOW);
  assert.ok(band);
  assert.ok(alphaAt(TALL_INSET, band.height * 0.8) <= 0.06);
  assert.ok(alphaAt(TALL_INSET, band.height - 1) < 0.01);
});

test('looks the same on every phone, in both the ways that show', () => {
  // Two things vary with the strip and both are visible, so both are pinned.
  //
  // The slope is how gradual the dissolve looks while scrolling. Hanging the
  // interior points off the bar's bottom edge made a segment proportional to
  // the strip and doubled the slope on a short one — a hard line again.
  //
  // The resting wash is how dimmed a heading looks when nothing is scrolled.
  // Content sits at `insets.top` plus a fixed margin on every device, so a
  // fixed-length ramp anchored only at its top slid content along the curve:
  // 23% washed on a short-strip phone against 13% on a tall-strip one.
  //
  // Anchoring both ends to the strip and placing the interior points along the
  // span between them is what holds both within a fraction of each other.
  const peaks = REAL_INSETS.map((inset) => Math.max(...slopes(inset)));
  const resting = REAL_INSETS.map((inset) => alphaAt(inset, inset + 24));

  assert.ok(spread(peaks) < 1.2, `peak slope spread ${spread(peaks).toFixed(2)}`);

  // Measured as a difference, not a ratio. What the eye compares between two
  // phones is how much darker one heading looks than the other, and a ratio
  // exaggerates that at small alphas — 10% against 15% is a fifth of a stop,
  // not "50% worse". Anchoring only the top of the ramp gave 13% against 23%,
  // which is the gap that showed.
  const restingGap = Math.max(...resting) - Math.min(...resting);
  assert.ok(restingGap < 0.06, `resting wash gap ${restingGap.toFixed(3)}`);

  // And bounded in absolute terms on the worst device, not just the best.
  assert.ok(Math.max(...peaks) < 0.025, `worst peak slope ${Math.max(...peaks).toFixed(4)}`);
  assert.ok(Math.max(...resting) < 0.17, `worst resting wash ${Math.max(...resting).toFixed(3)}`);
});

test('puts the same landmarks at close to the same alpha on every phone', () => {
  // The bar's bottom edge is where a heading finishes crossing into the strip.
  // It cannot be identical everywhere — the strip is the thing that varies —
  // but it must not swing far enough that one phone hides content the next one
  // shows.
  const barEdge = REAL_INSETS.map((inset) => alphaAt(inset, inset));
  assert.ok(Math.min(...barEdge) > 0.4, `weakest bar edge ${Math.min(...barEdge).toFixed(2)}`);
  assert.ok(Math.max(...barEdge) < 0.7, `strongest bar edge ${Math.max(...barEdge).toFixed(2)}`);
});

import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ARTWORK_VIEWER_MAX_ZOOM,
  ARTWORK_VIEWER_OVERSAMPLE,
  clampLiveZoom,
  clampPan,
  clampRestingZoom,
  getArtworkTravel,
  getArtworkViewerTarget,
  getDragProgress,
  isArtworkTap,
  normalizeArtworkAspect,
  shouldDismissDrag,
  zoomAbout,
} from './artworkViewerLayout.ts';
import {
  DETAIL_ART_COLLAPSED,
  DETAIL_BAR_H,
  DETAIL_THUMB_CENTER_X,
  getDetailArtFrame,
  getDetailExpandedHeight,
  getDetailHeroLayout,
} from './detailHeroLayout.ts';

const WINDOWS = [
  { name: 'S22 Ultra portrait', size: [411, 818], insets: { top: 40, bottom: 24, left: 0, right: 0 } },
  { name: 'Pixel 7 Pro portrait', size: [411, 891], insets: { top: 40, bottom: 24, left: 0, right: 0 } },
  { name: 'phone landscape', size: [891, 411], insets: { top: 24, bottom: 0, left: 40, right: 24 } },
  { name: 'tablet landscape', size: [1024, 768], insets: { top: 24, bottom: 24, left: 0, right: 0 } },
] as const;

const ASPECTS = [1, 16 / 9, 3 / 4, 2] as const;
const EPSILON = 1e-6;

function near(actual: number, expected: number, message: string) {
  assert.ok(Math.abs(actual - expected) < 1e-3, `${message}: ${actual} vs ${expected}`);
}

test('the target keeps the image aspect and stays inside the safe area', () => {
  for (const { name, size: [width, height], insets } of WINDOWS) {
    for (const aspect of ASPECTS) {
      const target = getArtworkViewerTarget(width, height, insets, aspect);
      const label = `${name} aspect ${aspect}`;
      near(target.width / target.height, aspect, `${label} aspect`);
      assert.ok(target.x >= insets.left - EPSILON, `${label} left`);
      assert.ok(target.y >= insets.top - EPSILON, `${label} top`);
      assert.ok(target.x + target.width <= width - insets.right + EPSILON, `${label} right`);
      assert.ok(target.y + target.height <= height - insets.bottom + EPSILON, `${label} bottom`);
      // It fills the box on at least one axis: "bigger" means as big as fits.
      const fillsWidth = Math.abs(target.width - (width - insets.left - insets.right)) < 1e-3;
      const fillsHeight = Math.abs(target.height - (height - insets.top - insets.bottom)) < 1e-3;
      assert.ok(fillsWidth || fillsHeight, `${label} fills an axis`);
    }
  }
});

test('a square cover spans the full width of a portrait phone', () => {
  const target = getArtworkViewerTarget(411, 818, { top: 40, bottom: 24, left: 0, right: 0 }, 1);
  assert.equal(target.width, 411);
  assert.equal(target.x, 0);
});

test('travel starts as the hero square and ends as the target rect', () => {
  const origin = { x: 100, y: 84, size: 210, radius: 16 };
  for (const { size: [width, height], insets } of WINDOWS) {
    for (const aspect of ASPECTS) {
      const target = getArtworkViewerTarget(width, height, insets, aspect);
      const start = getArtworkTravel(origin, target, 0);
      near(target.width * start.scaleX, origin.size, 'start width');
      near(target.height * start.scaleY, origin.size, 'start height');
      near(target.x + target.width / 2 + start.translateX, origin.x + origin.size / 2, 'start center x');
      near(target.y + target.height / 2 + start.translateY, origin.y + origin.size / 2, 'start center y');
      // Radius is in pre-scale units; drawn, it is the hero's radius on the
      // axis that scales least.
      near(start.radius * Math.min(start.scaleX, start.scaleY), origin.radius, 'start radius');

      const end = getArtworkTravel(origin, target, 1);
      near(end.scaleX, 1, 'end scaleX');
      near(end.scaleY, 1, 'end scaleY');
      near(end.translateX, 0, 'end translateX');
      near(end.translateY, 0, 'end translateY');
      near(end.radius, 0, 'end radius');
    }
  }
});

test('the image keeps its true aspect and covers the frame for the whole trip', () => {
  const origin = { x: 100, y: 84, size: 210, radius: 16 };
  for (const aspect of ASPECTS) {
    const target = getArtworkViewerTarget(411, 818, { top: 40, bottom: 24, left: 0, right: 0 }, aspect);
    for (const progress of [0, 0.25, 0.5, 0.75, 1]) {
      const travel = getArtworkTravel(origin, target, progress);
      // Size the image is drawn at: its oversampled layout, its own scale, then the frame's.
      const drawnWidth =
        target.width * ARTWORK_VIEWER_OVERSAMPLE * travel.imageScaleX * travel.scaleX;
      const drawnHeight =
        target.height * ARTWORK_VIEWER_OVERSAMPLE * travel.imageScaleY * travel.scaleY;
      const frameWidth = target.width * travel.scaleX;
      const frameHeight = target.height * travel.scaleY;
      near(drawnWidth / drawnHeight, aspect, `aspect ${aspect} at ${progress}`);
      assert.ok(drawnWidth >= frameWidth - 1e-3, `covers width at ${progress}`);
      assert.ok(drawnHeight >= frameHeight - 1e-3, `covers height at ${progress}`);
      // Cover, not overscan: one axis matches the frame exactly.
      assert.ok(
        Math.abs(drawnWidth - frameWidth) < 1e-3 || Math.abs(drawnHeight - frameHeight) < 1e-3,
        `tight on one axis at ${progress}`
      );
    }
  }
});

test('zoom limits', () => {
  assert.equal(clampRestingZoom(0.6), 1);
  assert.equal(clampRestingZoom(2.2), 2.2);
  assert.equal(clampRestingZoom(9), ARTWORK_VIEWER_MAX_ZOOM);
  assert.ok(clampLiveZoom(0.1) < 1, 'a pinch may undershoot');
  assert.ok(clampLiveZoom(100) > ARTWORK_VIEWER_MAX_ZOOM, 'and overshoot');
  assert.ok(clampLiveZoom(100) < ARTWORK_VIEWER_MAX_ZOOM * 2, 'but not without bound');
});

test('zooming about a point keeps the content under it in place', () => {
  const center = 205;
  for (const [focal, translation, from, to] of [
    [300, 0, 1, 2.5],
    [40, -60, 2, 4],
    [205, 30, 3, 1],
  ] as const) {
    // Content coordinate under the focal point before the zoom.
    const content = (focal - center - translation) / from;
    const next = zoomAbout(focal, center, translation, to / from);
    near(center + next + to * content, focal, `focal ${focal} ${from}->${to}`);
  }
});

test('pan limits', () => {
  // Square cover on a portrait phone: full width, letterboxed vertically.
  const target = getArtworkViewerTarget(411, 818, { top: 40, bottom: 24, left: 0, right: 0 }, 1);

  // Not zoomed: nothing to pan, the image re-centers.
  assert.equal(clampPan(120, target.x, target.width, 1, 411), 0);
  assert.equal(clampPan(-80, target.y, target.height, 1, 818), 0);

  // At 4x both axes overflow and each edge can be brought to the window edge, no further.
  const scale = 4;
  const maxX = clampPan(1e6, target.x, target.width, scale, 411);
  const minX = clampPan(-1e6, target.x, target.width, scale, 411);
  const centerX = target.x + target.width / 2;
  near(centerX + maxX - (target.width * scale) / 2, 0, 'left edge meets the window');
  near(centerX + minX + (target.width * scale) / 2, 411, 'right edge meets the window');
  assert.equal(clampPan(10, target.x, target.width, scale, 411), 10);

  // At 1.5x the square is wider than the window but still shorter than it.
  assert.notEqual(clampPan(1e6, target.x, target.width, 1.5, 411), 0);
  assert.equal(clampPan(1e6, target.y, target.height, 1.5, 818), 0);
});

test('drag to dismiss', () => {
  assert.equal(shouldDismissDrag(20, 0, 818), false);
  assert.equal(shouldDismissDrag(200, 0, 818), true);
  assert.equal(shouldDismissDrag(-200, 0, 818), true);
  assert.equal(shouldDismissDrag(30, 1500, 818), true);
  // A fling back toward the resting position is a change of mind.
  assert.equal(shouldDismissDrag(30, -1500, 818), false);

  assert.equal(getDragProgress(0, 0, 1, 818), 0);
  assert.equal(getDragProgress(0, 818, 1, 818), 1);
  assert.ok(getDragProgress(0, 100, 1, 818) > 0);
  // Zoomed in, a drag is a pan and must not fade the backdrop.
  assert.equal(getDragProgress(0, 300, 2, 818), 0);
});

test('tap classification', () => {
  assert.equal(isArtworkTap(100, 100, 0, 103, 98, 120), true);
  assert.equal(isArtworkTap(100, 100, 0, 100, 130, 120), false, 'a scroll is not a tap');
  assert.equal(isArtworkTap(100, 100, 0, 100, 100, 900), false, 'a long press is not a tap');
});

test('odd image dimensions fall back to a usable aspect', () => {
  assert.equal(normalizeArtworkAspect(0, 0), 1);
  assert.equal(normalizeArtworkAspect(Number.NaN, 500), 1);
  assert.equal(normalizeArtworkAspect(1000, 1000), 1);
  assert.equal(normalizeArtworkAspect(100000, 10), 4);
  assert.equal(normalizeArtworkAspect(10, 100000), 0.25);
});

test('the art frame matches the expanded hero at rest and the thumbnail when collapsed', () => {
  for (const [width, height, inset] of [[411, 818, 40], [891, 411, 24], [1024, 768, 24]] as const) {
    const hero = getDetailHeroLayout(width, height, inset);
    const expanded = getDetailExpandedHeight(hero, 154);

    const rest = getDetailArtFrame(hero, inset, expanded, 0);
    assert.equal(rest.x, hero.artLeft);
    assert.equal(rest.y, inset + hero.artTop);
    assert.equal(rest.size, hero.artSize);
    assert.equal(rest.scale, 1);

    const collapsed = getDetailArtFrame(hero, inset, expanded, expanded - DETAIL_BAR_H);
    near(collapsed.size, DETAIL_ART_COLLAPSED, 'collapsed size');
    // The header tweens from the layout's rounded art center, so an odd art
    // size lands half a dp off. The frame reports where it is really drawn.
    assert.ok(
      Math.abs(collapsed.x + collapsed.size / 2 - DETAIL_THUMB_CENTER_X) <= 0.5,
      'collapsed center x'
    );
    near(collapsed.y + collapsed.size / 2, inset + DETAIL_BAR_H / 2, 'collapsed center y');

    // Partway through the tappable range the frame has only moved up and in.
    const partway = getDetailArtFrame(hero, inset, expanded, 45);
    assert.ok(partway.y < rest.y, 'moves up');
    assert.ok(partway.size <= rest.size, 'never grows');
  }
});

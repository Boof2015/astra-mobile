import assert from 'node:assert/strict';
import test from 'node:test';
import { getHomeLayout, homeColumnWidth, HOME_COLUMN_GAP } from './homeLayout.ts';

/**
 * Content widths Home actually gets, measured off the shell: window width,
 * minus the rail when it is up, minus the screen gutters. Same reference points
 * as `library/libraryLayout.test.mts`, which is measured the same way.
 */
const PHONE_PORTRAIT = 380;
const PHONE_LANDSCAPE = 695;
const FOLD_COVER = 340;
const FOLD_OPEN_PORTRAIT = 808;
const TABLET_PORTRAIT = 768;
const TABLET_LANDSCAPE = 1200;
/** A 1200dp tablet with the player dock open: the dock takes 460 of the scene. */
const TABLET_LANDSCAPE_DOCKED = 740;
/** The narrowest a dock can leave a scene, from `DOCK_MIN_SCENE_WIDTH`. */
const DOCKED_MINIMUM = 420 - 32;

test('stacks Home full width on every phone-shaped scene', () => {
  for (const width of [FOLD_COVER, PHONE_PORTRAIT, DOCKED_MINIMUM, 600]) {
    assert.equal(getHomeLayout(width).paired, false, `width ${width}`);
    assert.equal(homeColumnWidth(width), width, `width ${width}`);
  }
});

test('pairs sections once both halves clear a phone-shaped column', () => {
  for (const width of [
    PHONE_LANDSCAPE,
    TABLET_PORTRAIT,
    FOLD_OPEN_PORTRAIT,
    TABLET_LANDSCAPE_DOCKED,
    TABLET_LANDSCAPE,
  ]) {
    assert.equal(getHomeLayout(width).paired, true, `width ${width}`);
  }
});

test('never pairs into a column narrower than the phone layout it reuses', () => {
  // The whole premise is that a column is a phone section in a narrower box.
  // If pairing can produce something narrower than the sections were drawn
  // against, the threshold is wrong rather than the sections.
  for (let width = 0; width <= 2000; width += 1) {
    if (!getHomeLayout(width).paired) continue;
    assert.ok(
      homeColumnWidth(width) >= 320,
      `paired at ${width} into ${homeColumnWidth(width)}dp columns`
    );
  }
});

test('pairing is monotonic in width — no scene loses a column by growing', () => {
  let seenPaired = false;
  for (let width = 0; width <= 2000; width += 1) {
    const paired = getHomeLayout(width).paired;
    if (paired) seenPaired = true;
    assert.ok(!(seenPaired && !paired), `unpaired again at ${width}`);
  }
});

test('the two columns and their gutter account for the whole scene', () => {
  for (const width of [PHONE_LANDSCAPE, TABLET_PORTRAIT, TABLET_LANDSCAPE]) {
    assert.equal(homeColumnWidth(width) * 2 + HOME_COLUMN_GAP, width, `width ${width}`);
  }
});

test('a phone in portrait sees exactly the layout it has today', () => {
  const phone = getHomeLayout(PHONE_PORTRAIT);
  assert.deepEqual(phone, {
    paired: false,
    spotlightCoverSize: 88,
    railCoverSize: 112,
    recentTrackCount: 3,
  });
});

test('treats an unmeasured scene as a phone rather than guessing wide', () => {
  // First frame, before `onLayout`. Falling back to the wide shape would show a
  // two-column band that collapses a frame later.
  for (const width of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.equal(getHomeLayout(width).paired, false, `width ${width}`);
  }
});

test('grows the spotlight cover in declared tiers, never past its column', () => {
  const seen = new Set<number>();
  for (let width = 0; width <= 2000; width += 1) {
    const { spotlightCoverSize } = getHomeLayout(width);
    seen.add(spotlightCoverSize);
    // Cover, the card's own padding, and the gap before the meta. What is left
    // has to seat three 36dp action buttons and their gaps.
    const meta = homeColumnWidth(width) - spotlightCoverSize - 12 * 3;
    if (getHomeLayout(width).paired) {
      assert.ok(meta >= 124, `cover ${spotlightCoverSize} leaves ${meta}dp at ${width}`);
    }
  }
  assert.deepEqual([...seen].sort((a, b) => a - b), [88, 112, 144]);
});

test('spends extra width on rail tiles and recent rows, not on stretching rows', () => {
  const phone = getHomeLayout(PHONE_PORTRAIT);
  const tablet = getHomeLayout(TABLET_LANDSCAPE);
  assert.ok(tablet.railCoverSize > phone.railCoverSize);
  assert.ok(tablet.recentTrackCount > phone.recentTrackCount);
});

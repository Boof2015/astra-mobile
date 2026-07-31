import assert from 'node:assert/strict';
import test from 'node:test';
import {
  getShellLayout,
  railContentsFit,
  SHELL_NAV_ITEM_COUNT,
  type ShellInsets,
} from './shellLayout.ts';

/** Portrait insets; landscape swaps the cutout onto the leading edge. */
const PORTRAIT: ShellInsets = { top: 40, bottom: 24, left: 0, right: 0 };
const LANDSCAPE: ShellInsets = { top: 24, bottom: 24, left: 48, right: 24 };

const DEVICES = [
  { name: 'Pixel 7 Pro', portrait: [411, 891], landscape: [891, 411] },
  { name: 'Galaxy S22', portrait: [360, 780], landscape: [780, 360] },
  { name: 'Poco M5', portrait: [393, 873], landscape: [873, 393] },
  { name: 'Galaxy S25 Ultra', portrait: [411, 882], landscape: [882, 411] },
  { name: 'Tablet 10"', portrait: [768, 1024], landscape: [1024, 768] },
  { name: 'small phone', portrait: [320, 568], landscape: [568, 320] },
] as const;

const FONT_SCALES = [1, 1.2] as const;

test('the rail is for landscape windows and only landscape windows', () => {
  for (const fontScale of FONT_SCALES) {
    for (const device of DEVICES) {
      const [pw, ph] = device.portrait;
      assert.equal(
        getShellLayout(pw, ph, PORTRAIT, fontScale).mode,
        'tabs',
        `${device.name} portrait should keep the bottom tabs`
      );
      const [lw, lh] = device.landscape;
      assert.equal(
        getShellLayout(lw, lh, LANDSCAPE, fontScale).mode,
        'rail',
        `${device.name} landscape should get the rail`
      );
    }
  }
});

test('a window with no room for a rail keeps its tabs', () => {
  for (const [width, height, why] of [
    [411, 420, 'portrait-ish split screen'],
    [360, 640, 'phone portrait'],
    [320, 480, 'small phone portrait'],
    [460, 400, 'landscape but too narrow for rail + content'],
    [900, 200, 'landscape but too short to host the nav items'],
  ] as const) {
    assert.equal(
      getShellLayout(width, height, LANDSCAPE, 1).mode,
      'tabs',
      `${why} (${width}x${height}) should keep the bottom tabs`
    );
  }
});

test('rail contents always fit the rail', () => {
  for (const fontScale of FONT_SCALES) {
    for (const device of DEVICES) {
      const [width, height] = device.landscape;
      const layout = getShellLayout(width, height, LANDSCAPE, fontScale);
      assert.ok(
        railContentsFit(layout),
        `${device.name} @${fontScale}: ${SHELL_NAV_ITEM_COUNT} nav items (${layout.navItemHeight} each) + mini player ${layout.miniPlayer.blockHeight} exceed rail height ${layout.railHeight}`
      );
    }
  }
});

test('the mini player gives ground instead of overflowing', () => {
  // Walk the rail from generous down to nothing; the block may only shrink, and
  // it must never push past the rail.
  let previous = Number.POSITIVE_INFINITY;
  for (let height = 800; height >= 240; height -= 4) {
    const layout = getShellLayout(1000, height, LANDSCAPE, 1);
    const block = layout.miniPlayer.blockHeight;
    assert.ok(
      block <= previous,
      `mini player grew from ${previous} to ${block} as the rail shrank to ${height}`
    );
    assert.ok(
      railContentsFit(layout),
      `rail overflows at height ${height}: nav ${layout.navItemHeight * SHELL_NAV_ITEM_COUNT} + mini ${block} > ${layout.railHeight}`
    );
    previous = block;
  }
});

test('sacrifices the artwork before the title, and the title before the controls', () => {
  const roomy = getShellLayout(1000, 800, LANDSCAPE, 1).miniPlayer;
  assert.ok(roomy.artSize > 0 && roomy.titleLineHeight > 0 && roomy.controlSize > 0);

  // Somewhere on the way down the artwork shrinks, then the title drops, then
  // the artwork goes — but the controls survive as long as anything does.
  let sawSmallerArt = false;
  let sawTitleDropped = false;
  for (let height = 800; height >= 240; height -= 2) {
    const mini = getShellLayout(1000, height, LANDSCAPE, 1).miniPlayer;
    if (mini.artSize > 0 && mini.artSize < roomy.artSize) sawSmallerArt = true;
    if (mini.artSize > 0 && mini.titleLineHeight === 0) sawTitleDropped = true;
    if (mini.blockHeight > 0) {
      assert.ok(
        mini.controlSize > 0,
        `at height ${height} the block is ${mini.blockHeight}dp but has no controls`
      );
    }
    if (mini.titleLineHeight > 0) {
      assert.ok(
        mini.artSize > 0,
        `at height ${height} the title survived without artwork`
      );
    }
  }
  assert.ok(sawSmallerArt, 'artwork should shrink before anything is dropped');
  assert.ok(sawTitleDropped, 'the title should drop while artwork still fits');
});

test('protects the mini player by shrinking nav items first', () => {
  // A Galaxy S22 in landscape (780x360) is the tight case: holding nav items at
  // their preferred 52dp starved the mini player of artwork AND title by 2dp.
  for (const [width, height, name] of [
    [780, 360, 'Galaxy S22 landscape'],
    [873, 393, 'Poco M5 landscape'],
    [891, 411, 'Pixel 7 Pro landscape'],
  ] as const) {
    const layout = getShellLayout(width, height, LANDSCAPE, 1);
    assert.equal(layout.mode, 'rail');
    assert.ok(
      layout.miniPlayer.artSize > 0,
      `${name}: rail mini player lost its artwork (nav items at ${layout.navItemHeight}dp)`
    );
    assert.ok(
      layout.miniPlayer.titleLineHeight > 0,
      `${name}: rail mini player lost its title`
    );
    assert.ok(railContentsFit(layout));
  }
});

test('artwork is square, so it never exceeds the rail width', () => {
  for (const fontScale of FONT_SCALES) {
    for (const device of DEVICES) {
      const [width, height] = device.landscape;
      const layout = getShellLayout(width, height, LANDSCAPE, fontScale);
      assert.ok(
        layout.miniPlayer.artSize <= layout.railContentWidth,
        `${device.name}: artwork ${layout.miniPlayer.artSize} is wider than the rail's ${layout.railContentWidth}`
      );
    }
  }
});

test('the rail carries the leading safe-area inset', () => {
  const bare = getShellLayout(891, 411, { top: 24, bottom: 24, left: 0, right: 0 }, 1);
  const cutout = getShellLayout(891, 411, LANDSCAPE, 1);
  assert.equal(cutout.railWidth - bare.railWidth, LANDSCAPE.left);
  assert.equal(bare.railWidth, 104);
  // The inset is padding, not usable width.
  assert.equal(cutout.railContentWidth, bare.railContentWidth);
});

test('a larger font setting grows the nav items but never overflows', () => {
  for (const device of DEVICES) {
    const [width, height] = device.landscape;
    const small = getShellLayout(width, height, LANDSCAPE, 1);
    const large = getShellLayout(width, height, LANDSCAPE, 1.2);
    assert.ok(
      large.navItemHeight >= small.navItemHeight,
      `${device.name}: a larger font setting shrank the nav items (${small.navItemHeight} -> ${large.navItemHeight})`
    );
    assert.ok(railContentsFit(large));
  }
  // Past the cap nothing moves.
  const capped = getShellLayout(891, 411, LANDSCAPE, 1.2);
  const beyond = getShellLayout(891, 411, LANDSCAPE, 3);
  assert.deepEqual(beyond, capped);
});

test('keeps every dimension finite and non-negative', () => {
  for (const device of DEVICES) {
    for (const [width, height] of [device.portrait, device.landscape]) {
      for (const fontScale of FONT_SCALES) {
        const layout = getShellLayout(width, height, LANDSCAPE, fontScale);
        for (const [key, value] of Object.entries(layout)) {
          if (typeof value !== 'number') continue;
          assert.ok(Number.isFinite(value), `${key} is not finite`);
          assert.ok(value >= 0, `${key} is negative`);
        }
        for (const [key, value] of Object.entries(layout.miniPlayer)) {
          if (typeof value !== 'number') continue;
          assert.ok(Number.isFinite(value), `miniPlayer.${key} is not finite`);
          assert.ok(value >= 0, `miniPlayer.${key} is negative`);
        }
      }
    }
  }
});

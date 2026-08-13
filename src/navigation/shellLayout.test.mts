import assert from 'node:assert/strict';
import test from 'node:test';
import {
  getShellLayout,
  railContentsFit,
  splitBarContentsFit,
  SHELL_NAV_ITEM_COUNT,
  SPLIT_CARD_PADDING,
  type ShellInsets,
} from './shellLayout.ts';
import { variantLineHeight } from '../theme/typography.ts';

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

test('a phone gets the rail in landscape and tabs in portrait', () => {
  for (const fontScale of FONT_SCALES) {
    for (const device of DEVICES) {
      if (device.name === 'Tablet 10"') continue; // tall enough to afford a bar
      const [lw, lh] = device.landscape;
      assert.equal(
        getShellLayout(lw, lh, LANDSCAPE, fontScale).mode,
        'rail',
        `${device.name} landscape should get the rail`
      );
      const [pw, ph] = device.portrait;
      assert.equal(
        getShellLayout(pw, ph, PORTRAIT, fontScale).mode,
        'tabs',
        `${device.name} portrait should keep the bottom tabs`
      );
    }
  }
});

test('a tablet splits in BOTH orientations rather than wearing a phone rail', () => {
  // The rail answers scarce height, not landscape. A tablet in landscape is
  // short relative to its width but still ~770dp tall, and paying 104dp of
  // width for height it already has is the phone's solution on the wrong device.
  for (const fontScale of FONT_SCALES) {
    for (const [w, h, name] of [
      [768, 1024, 'Tablet 10" portrait'],
      [1024, 768, 'Tablet 10" landscape'],
      [1274, 796, 'large tablet landscape'],
      [796, 1274, 'large tablet portrait'],
      [834, 1112, 'iPad-ish portrait'],
      [1112, 834, 'iPad-ish landscape'],
    ] as const) {
      assert.equal(
        getShellLayout(w, h, PORTRAIT, fontScale).mode,
        'split',
        `${name} (${w}x${h}) should share the bottom row`
      );
    }
  }
});

test('a window wide enough to seat both groups in one row gets the split bar', () => {
  for (const fontScale of FONT_SCALES) {
    // An unfolded foldable in portrait.
    assert.equal(getShellLayout(674, 841, PORTRAIT, fontScale).mode, 'split');
    // A window too short for a rail but wide enough to share a row is better
    // off splitting than stacking a bar and a floating pill.
    assert.equal(getShellLayout(900, 200, LANDSCAPE, fontScale).mode, 'split');
  }
});

test('the rail survives exactly where height is actually scarce', () => {
  // Sweep a wide window from short to tall: the rail is for the short end, the
  // split bar for the tall end, and the handover happens once and stays.
  let sawRail = false;
  let sawSplit = false;
  for (let height = 340; height <= 900; height += 4) {
    const mode = getShellLayout(1000, height, LANDSCAPE, 1).mode;
    if (mode === 'rail') {
      assert.ok(!sawSplit, `fell back to the rail at ${height}dp after splitting`);
      sawRail = true;
    } else {
      assert.equal(mode, 'split', `unexpected ${mode} at 1000x${height}`);
      sawSplit = true;
    }
  }
  assert.ok(sawRail && sawSplit, 'the sweep should cross the handover');
});

test('a window with room for neither a rail nor a split keeps its tabs', () => {
  for (const [width, height, why] of [
    [411, 420, 'portrait-ish split screen'],
    [360, 640, 'phone portrait'],
    [320, 480, 'small phone portrait'],
    [460, 400, 'landscape but too narrow for rail + content'],
  ] as const) {
    assert.equal(
      getShellLayout(width, height, LANDSCAPE, 1).mode,
      'tabs',
      `${why} (${width}x${height}) should keep the bottom tabs`
    );
  }
});

test('the split threshold is the width both groups actually need', () => {
  // Walk across the boundary: the mode may only ever turn on, and the moment it
  // does the contents must already fit — a threshold that fires a pixel early
  // ships a clipped bar.
  const insets: ShellInsets = { top: 40, bottom: 24, left: 0, right: 0 };
  let sawTabs = false;
  let sawSplit = false;
  for (let width = 380; width <= 900; width += 1) {
    const layout = getShellLayout(width, 1200, insets, 1);
    if (layout.mode === 'tabs') {
      assert.ok(!sawSplit, `mode fell back to tabs at ${width}dp after splitting`);
      sawTabs = true;
    } else {
      assert.equal(layout.mode, 'split');
      sawSplit = true;
      assert.ok(
        splitBarContentsFit(layout, width, insets),
        `split bar overflows at ${width}dp`
      );
    }
  }
  assert.ok(sawTabs && sawSplit, 'the sweep should cross the threshold');
});

test('split bar contents always fit their row', () => {
  for (const fontScale of FONT_SCALES) {
    // Portrait-shaped throughout: a wide *landscape* window gets the rail, which
    // is a different shape with its own fit test.
    for (const width of [600, 640, 674, 768, 834, 1024, 1366, 2000]) {
      const layout = getShellLayout(width, width + 600, PORTRAIT, fontScale);
      assert.equal(layout.mode, 'split', `${width}dp should split`);
      assert.ok(
        splitBarContentsFit(layout, width, PORTRAIT),
        `${width}dp @${fontScale}: ${SHELL_NAV_ITEM_COUNT} nav items (${layout.splitBar.navItemWidth} each) + mini ${layout.splitBar.miniWidth} overflow`
      );
    }
  }
});

test('split nav items concede width before the mini player does', () => {
  // At the narrowest split window the nav items should be the ones compressed,
  // and the mini player should still be at a legible width — the same priority
  // the rail applies to height.
  const tight = getShellLayout(600, 1000, PORTRAIT, 1);
  const roomy = getShellLayout(1024, 1400, PORTRAIT, 1);
  assert.equal(tight.mode, 'split');
  assert.ok(
    tight.splitBar.navItemWidth <= roomy.splitBar.navItemWidth,
    'nav items should be the part that gives ground'
  );
  assert.ok(
    tight.splitBar.miniWidth >= 280,
    `mini player fell below its floor (${tight.splitBar.miniWidth}dp)`
  );
  assert.ok(tight.splitBar.artSize > 0 && tight.splitBar.controlSize > 0);
});

test('the two cards divide the row instead of drifting to opposite edges', () => {
  // The gap is fixed and small; whatever width exists goes into the cards. A
  // 1274dp tablet used to leave a ~490dp chasm between them, which read as two
  // unrelated things sharing an edge rather than one control.
  for (const width of [640, 768, 834, 1024, 1274]) {
    const bar = getShellLayout(width, width + 600, PORTRAIT, 1).splitBar;
    const used = bar.navWidth + 12 + bar.miniWidth;
    const available = width - 12 * 2;
    const slack = available - used;
    assert.ok(slack >= 0, `${width}dp overflows by ${-slack}dp`);
    // Slack only appears once BOTH cards are capped; until then the row fills.
    if (slack > 0) {
      assert.equal(bar.miniWidth, 560, `${width}dp left ${slack}dp slack uncapped`);
      assert.equal(bar.navItemWidth, 88);
    }
  }
});

test('the pair is capped so a huge window centres it rather than smearing it', () => {
  const wide = getShellLayout(2000, 2600, PORTRAIT, 1).splitBar;
  assert.equal(wide.miniWidth, 560, 'player card should cap');
  assert.equal(wide.navItemWidth, 88, 'nav items should sit at their ideal width');
  assert.ok(wide.navWidth + 12 + wide.miniWidth < 2000 - 24, 'should leave slack to centre');
});

test('the nav card leaves room for the indicator inside its clipped edge', () => {
  // The card clips to its rounded border, so anything flush to its top gets
  // shaved — which is exactly what happened to the selection indicator. The
  // items live in the padded box, and that box has to fit the indicator too.
  const INDICATOR_BAR_HEIGHT = 3; // styles.indicatorBar in TabBar
  for (const fontScale of FONT_SCALES) {
    for (const width of [600, 768, 1024, 1274]) {
      const layout = getShellLayout(width, width + 600, PORTRAIT, fontScale);
      const paddedBox = layout.splitBar.height - SPLIT_CARD_PADDING * 2;
      const needed =
        layout.navIconSize +
        layout.navLabelGap +
        Math.ceil(variantLineHeight.caption * fontScale) +
        INDICATOR_BAR_HEIGHT;
      assert.ok(
        paddedBox >= needed,
        `${width}dp @${fontScale}: padded box ${paddedBox}dp cannot fit ${needed}dp of item + indicator`
      );
    }
  }
});

test('the nav card steps back to a declared compact width when docked', () => {
  // A stated intent, not a leftover: it must be the SAME compact width on every
  // window, never "whatever is left after reserving for a card we do not draw".
  const widths = new Set<number>();
  for (const [w, h] of [[1274, 796], [1112, 834], [1024, 768], [930, 775]] as const) {
    const bare = getShellLayout(w, h, PORTRAIT, 1, false);
    const docked = getShellLayout(w, h, PORTRAIT, 1, true);
    if (!docked.docked || bare.mode !== 'split' || docked.mode !== 'split') continue;
    assert.ok(
      docked.splitBar.navItemWidth < bare.splitBar.navItemWidth,
      `${w}x${h}: nav items should tighten beside a pane`
    );
    assert.ok(docked.splitBar.navItemWidth >= 64, 'never below the label floor');
    widths.add(docked.splitBar.navItemWidth);
  }
  assert.equal(widths.size, 1, `docked width varied by window: ${[...widths]}`);
});

test('a docked split bar reserves nothing for the player card', () => {
  for (const [w, h] of [[1274, 796], [1024, 768], [930, 775]] as const) {
    const docked = getShellLayout(w, h, PORTRAIT, 1, true);
    if (!docked.docked || docked.mode !== 'split') continue;
    assert.equal(
      docked.splitBar.miniWidth,
      0,
      `${w}x${h}: still sizing a player card the dock replaced`
    );
  }
});

test('both cards are the same height, because they are peers', () => {
  for (const width of [600, 768, 1024, 1274]) {
    const bar = getShellLayout(width, width + 600, PORTRAIT, 1).splitBar;
    assert.ok(bar.height > 0);
    assert.equal(bar.blockHeight, bar.height + 12 * 2);
  }
});

test('the shapes that float chrome over the scene are the ones that reserve it', () => {
  // Surfaces reserve `sceneBottomInset`. Tabs floats a pill and split floats a
  // pair of cards, so both owe the space back; the rail sits *beside* the scene
  // and owes nothing — reserving there is dead space at the end of every list.
  assert.ok(getShellLayout(411, 891, PORTRAIT, 1).sceneBottomInset > 0);
  assert.equal(getShellLayout(891, 411, LANDSCAPE, 1).sceneBottomInset, 0);

  const tablet = getShellLayout(768, 1024, PORTRAIT, 1);
  assert.equal(
    tablet.sceneBottomInset,
    tablet.splitBar.blockHeight + PORTRAIT.bottom,
    'split must reserve the floating pair plus the safe area under it'
  );
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

/* ── player dock ────────────────────────────────────────────────────────── */

test('only a window that can spare the width is offered a dock', () => {
  // Landscape and tall enough to be worth a player column, with a usable scene
  // behind it. Portrait keeps the fullscreen player; phones never dock.
  for (const [w, h, allowed, why] of [
    [1274, 796, true, 'large tablet landscape'],
    [1112, 834, true, 'iPad-ish landscape'],
    [1024, 768, true, '10" landscape'],
    [930, 775, true, 'Pixel Fold unfolded'],
    [841, 701, true, 'foldable, narrower'],
    [768, 1024, false, '10" portrait — vertical keeps fullscreen'],
    [796, 1274, false, 'large tablet portrait'],
    [891, 411, false, 'phone landscape — too short for a player column'],
    [411, 891, false, 'phone portrait'],
  ] as const) {
    assert.equal(
      getShellLayout(w, h, PORTRAIT, 1, true).dockAllowed,
      allowed,
      `${why} (${w}x${h})`
    );
  }
});

test('the dock and the rail can never both be up', () => {
  // Their thresholds are the same number on purpose: a window short enough to
  // want a rail is too short to host a player column beside it.
  for (let width = 480; width <= 2000; width += 20) {
    for (let height = 300; height <= 1200; height += 20) {
      const layout = getShellLayout(width, height, PORTRAIT, 1, true);
      assert.ok(
        !(layout.docked && layout.mode === 'rail'),
        `${width}x${height} produced a rail and a dock at once`
      );
    }
  }
});

test('a dock the window cannot seat is refused, not squeezed in', () => {
  for (const [w, h] of [[768, 1024], [891, 411], [411, 891]] as const) {
    const layout = getShellLayout(w, h, PORTRAIT, 1, true);
    assert.equal(layout.docked, false);
    assert.equal(layout.dockWidth, 0);
    assert.equal(layout.sceneWidth, w, 'the scene should keep the whole window');
  }
});

test('a docked shell never floats a player of its own', () => {
  // The dock IS the player. Whatever shape the column behind it lands on, it
  // must not also render a mini player — that would be the same track twice —
  // so a docked `tabs` shell owes the scene nothing at its bottom.
  for (const [w, h] of [
    [1274, 796], [1112, 834], [1024, 768], [930, 775], [841, 701], [1600, 1000],
  ] as const) {
    const docked = getShellLayout(w, h, PORTRAIT, 1, true);
    assert.equal(docked.docked, true, `${w}x${h} should dock`);
    assert.notEqual(docked.mode, 'rail');
    if (docked.mode === 'tabs') {
      assert.equal(
        docked.sceneBottomInset,
        0,
        `${w}x${h}: docked tabs reserved space for a pill that isn't rendered`
      );
    } else {
      assert.ok(
        splitBarContentsFit(
          docked,
          docked.sceneWidth,
          { ...PORTRAIT, right: docked.sceneInsetRight }
        ),
        `${w}x${h}: nav card overflows the column left beside the dock`
      );
    }
  }
});

test('the scene keeps a usable column behind any dock it accepts', () => {
  for (let width = 600; width <= 2400; width += 8) {
    for (const height of [700, 800, 1000]) {
      const layout = getShellLayout(width, height, PORTRAIT, 1, true);
      if (!layout.docked) continue;
      assert.ok(
        layout.sceneWidth - PORTRAIT.left >= 420,
        `${width}x${height}: dock left only ${layout.sceneWidth}dp of scene`
      );
    }
  }
});

test('the dock takes the trailing edge, and its safe-area inset with it', () => {
  const insets: ShellInsets = { top: 24, bottom: 24, left: 48, right: 24 };
  const docked = getShellLayout(1274, 796, insets, 1, true);
  assert.equal(docked.sceneWidth, 1274 - docked.dockWidth);
  assert.equal(docked.sceneInsetRight, 0, 'the dock is what sits on that edge now');

  const bare = getShellLayout(1274, 796, insets, 1, false);
  assert.equal(bare.sceneInsetRight, insets.right, 'undocked, the scene pays it');
});

test('dock width is a share of the window, clamped at both ends', () => {
  for (const width of [1024, 1274, 1600, 2400, 4000]) {
    const bar = getShellLayout(width, 900, PORTRAIT, 1, true);
    if (!bar.docked) continue;
    assert.ok(bar.dockWidth >= 340, `${width}dp gave a ${bar.dockWidth}dp dock`);
    assert.ok(bar.dockWidth <= 520, `${width}dp gave a ${bar.dockWidth}dp dock`);
  }
});

test('dock availability only ever turns on as a window widens', () => {
  let sawAllowed = false;
  for (let width = 600; width <= 2000; width += 4) {
    const allowed = getShellLayout(width, 900, PORTRAIT, 1, true).dockAllowed;
    if (allowed) sawAllowed = true;
    else assert.ok(!sawAllowed, `dock became unavailable again at ${width}dp`);
  }
  assert.ok(sawAllowed, 'the sweep should cross the threshold');
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
        for (const [key, value] of Object.entries(layout.splitBar)) {
          if (typeof value !== 'number') continue;
          assert.ok(Number.isFinite(value), `splitBar.${key} is not finite`);
          assert.ok(value >= 0, `splitBar.${key} is negative`);
        }
      }
    }
  }
});

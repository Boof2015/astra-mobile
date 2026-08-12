import assert from 'node:assert/strict';
import test from 'node:test';
import {
  SCREEN_BAR_H,
  SCREEN_HEADER_EXPANDED_ACTION_SIZE,
  SCREEN_HEADER_GUTTER,
  compactActionsOpacityAt,
  expandedActionsOpacityAt,
  getScreenHeaderLayout,
  headerHeightAt,
  labelOpacityAt,
  titleBoundsAt,
  titleSlideAt,
  type ScreenHeaderInput,
} from './screenHeaderLayout.ts';
import { MAX_FONT_SCALE, variantLineHeight } from '../theme/typography.ts';

const WINDOWS = [
  { name: 'Pixel 7 Pro', phone: true, portrait: [411, 891, 40], landscape: [891, 411, 24] },
  { name: 'Galaxy S22', phone: true, portrait: [360, 780, 40], landscape: [780, 360, 24] },
  { name: 'Poco M5', phone: true, portrait: [393, 873, 40], landscape: [873, 393, 24] },
  { name: 'Tablet 10"', phone: false, portrait: [768, 1024, 24], landscape: [1024, 768, 24] },
  { name: 'small phone', phone: true, portrait: [320, 568, 24], landscape: [568, 320, 24] },
] as const;

const FONT_SCALES = [0.85, 1, 1.15, 1.2, 1.3, 2] as const;
const ACTION_COUNTS = [0, 1, 2, 3] as const;
/** How much of the width `Screen` can take away: nothing, a cutout, a docked player. */
const WIDTH_LOSSES = [0, 24, 48] as const;
/** No pinned chrome, and Library's switcher + sort row. */
const CHROME_HEIGHTS = [0, 84] as const;

type Case = { label: string; input: ScreenHeaderInput };

function cases(): Case[] {
  const out: Case[] = [];
  for (const entry of WINDOWS) {
    for (const [orientation, dims] of [
      ['portrait', entry.portrait],
      ['landscape', entry.landscape],
    ] as const) {
      const [width, height, topInset] = dims;
      for (const fontScale of FONT_SCALES) {
        for (const hasSubtitle of [false, true]) {
          for (const hasBack of [false, true]) {
            for (const actionCount of ACTION_COUNTS) {
              for (const loss of WIDTH_LOSSES) {
                for (const chromeHeight of CHROME_HEIGHTS) {
                  for (const hasExpandedActions of [false, true]) {
                    out.push({
                      label: `${entry.name} ${orientation} ${width}x${height} fs${fontScale} sub:${hasSubtitle} back:${hasBack} actions:${actionCount} expanded:${hasExpandedActions} -${loss}w chrome:${chromeHeight}`,
                      input: {
                        availableWidth: width - loss,
                        windowHeight: height,
                        topInset,
                        fontScale,
                        hasSubtitle,
                        hasBack,
                        actionCount,
                        hasExpandedActions,
                        chromeHeight,
                      },
                    });
                  }
                }
              }
            }
          }
        }
      }
    }
  }
  return out;
}

const ALL = cases();

test('the header always leaves the list a reachable strip', () => {
  // Ported from detailHeroLayout's guard. A header taller than its window puts
  // row 1 off the bottom AND covers the viewport, so no drag reaches the
  // scroller and the page cannot be scrolled at all.
  for (const { label, input } of ALL) {
    const layout = getScreenHeaderLayout(input);
    // Chrome counts: it is pinned below the title, so the list clears both.
    const total = layout.contentPaddingTop;
    assert.ok(total < input.windowHeight, `${label}: header ${total} >= window ${input.windowHeight}`);
    assert.ok(
      input.windowHeight - total >= 80,
      `${label}: only ${input.windowHeight - total}dp of list left`
    );
  }
});

test('windows too short for a large title get a static bar', () => {
  for (const entry of WINDOWS) {
    for (const [orientation, dims] of [
      ['portrait', entry.portrait],
      ['landscape', entry.landscape],
    ] as const) {
      const [width, height, topInset] = dims;
      const layout = getScreenHeaderLayout({
        availableWidth: width,
        windowHeight: height,
        topInset,
        fontScale: 1,
        hasSubtitle: true,
        hasBack: true,
        actionCount: 0,
      });
      // Phones in landscape are the case this exists for: 411dp of height minus
      // the inset leaves a header with two rows under it.
      const expected = !(entry.phone && orientation === 'landscape');
      assert.equal(
        layout.collapsible,
        expected,
        `${entry.name} ${orientation}: collapsible should be ${expected}`
      );
    }
  }

  for (const { label, input } of ALL) {
    const layout = getScreenHeaderLayout(input);
    if (layout.collapsible) continue;
    assert.equal(layout.expandedHeight, SCREEN_BAR_H, `${label}: static header must be one bar tall`);
    assert.equal(layout.dist, 0, `${label}: static header must not travel`);
    assert.equal(layout.settle, 0, `${label}: static header must not travel`);
  }
});

test('the title lands dead-centre in the bar', () => {
  for (const { label, input } of ALL) {
    const layout = getScreenHeaderLayout(input);
    assert.equal(
      layout.titleTop + layout.titleLine / 2 + layout.travelY,
      SCREEN_BAR_H / 2,
      `${label}: collapsed title misses the bar centre`
    );
  }
});

test('the travel is independent of the top inset', () => {
  // travelY is expressed below the inset, so the inset cancels. That is what
  // makes the motion identical on every device — and provable without one.
  for (const fontScale of FONT_SCALES) {
    for (const hasSubtitle of [false, true]) {
      const base = {
        availableWidth: 360,
        windowHeight: 780,
        fontScale,
        hasSubtitle,
        hasBack: true,
        actionCount: 1,
      };
      const shallow = getScreenHeaderLayout({ ...base, topInset: 24 });
      const deep = getScreenHeaderLayout({ ...base, topInset: 40 });
      assert.equal(shallow.travelY, deep.travelY, `fs${fontScale} sub:${hasSubtitle}: travelY moved`);
      assert.equal(shallow.travelX, deep.travelX);
      assert.equal(shallow.dist, deep.dist);
      assert.equal(shallow.expandedHeight, deep.expandedHeight);
    }
  }
});

test('the collapsed title clears the action buttons', () => {
  // The title is laid out and ellipsized at the *expanded* width, then scaled
  // down, so it can only ever get narrower — but it also slides right, and the
  // actions are pinned. This is the proof they never meet.
  for (const { label, input } of ALL) {
    const layout = getScreenHeaderLayout(input);
    assert.ok(
      layout.collapsedTitleRight <= input.availableWidth - layout.actionsWidth,
      `${label}: collapsed title reaches ${layout.collapsedTitleRight}, actions start at ${input.availableWidth - layout.actionsWidth}`
    );
  }
});

test('the collapse has room to read as motion', () => {
  for (const { label, input } of ALL) {
    const layout = getScreenHeaderLayout(input);
    if (!layout.collapsible) continue;
    assert.ok(layout.dist >= 72, `${label}: only ${layout.dist}dp of collapse`);
    assert.ok(layout.settle > 0 && layout.settle <= layout.dist, `${label}: bad settle`);
    // The stagger has to stay ordered, or the title slides before it shrinks.
    assert.ok(0 < layout.settle * 0.3, `${label}: scale stage is empty`);
    assert.ok(layout.settle * 0.3 < layout.settle * 0.45, `${label}: stagger out of order`);
    assert.ok(layout.settle * 0.45 < layout.settle, `${label}: slide stage is empty`);
  }
});

test('expanded actions sit beside the title without adding height and hand off cleanly', () => {
  const input = {
    availableWidth: 360,
    windowHeight: 780,
    topInset: 40,
    fontScale: 1,
    hasSubtitle: false,
    hasBack: false,
    actionCount: 2,
  };
  const bare = getScreenHeaderLayout(input);
  const layout = getScreenHeaderLayout({ ...input, hasExpandedActions: true });
  assert.equal(layout.expandedHeight, bare.expandedHeight);
  assert.equal(layout.expandedActionsHeight, SCREEN_HEADER_EXPANDED_ACTION_SIZE);
  assert.ok(layout.expandedActionsTop >= layout.titleTop);
  assert.ok(layout.expandedActionsTop + layout.expandedActionsHeight <= layout.titleTop + layout.titleLine);
  assert.ok(layout.titleRight > bare.titleRight);
  assert.equal(expandedActionsOpacityAt(0, layout.settle), 1);
  assert.equal(compactActionsOpacityAt(0, layout.settle), 0);
  assert.equal(expandedActionsOpacityAt(layout.settle, layout.settle), 0);
  assert.equal(compactActionsOpacityAt(layout.settle, layout.settle), 1);
  for (let y = 0; y <= layout.settle; y += 1) {
    assert.ok(
      expandedActionsOpacityAt(y, layout.settle) === 0 ||
      compactActionsOpacityAt(y, layout.settle) === 0,
      `expanded and compact actions overlap at ${y}`,
    );
  }
});

test('a larger font setting only ever grows the header, and the cap binds', () => {
  for (const entry of WINDOWS) {
    for (const dims of [entry.portrait, entry.landscape]) {
      const [width, height, topInset] = dims;
      for (const hasSubtitle of [false, true]) {
        let previousHeight = 0;
        let previousCollapsible = true;
        for (const fontScale of FONT_SCALES) {
          const layout = getScreenHeaderLayout({
            availableWidth: width,
            windowHeight: height,
            topInset,
            fontScale,
            hasSubtitle,
            hasBack: true,
            actionCount: 1,
          });
          assert.equal(
            layout.titleLine,
            Math.round(variantLineHeight.title * Math.min(Math.max(fontScale, 1), MAX_FONT_SCALE)),
            `${entry.name} fs${fontScale}: titleLine ignores the cap`
          );
          // Once a window gives up on the large title it must not get it back.
          assert.ok(
            !layout.collapsible || previousCollapsible,
            `${entry.name} fs${fontScale}: collapsible came back`
          );
          if (layout.collapsible && previousCollapsible) {
            assert.ok(
              layout.expandedHeight >= previousHeight,
              `${entry.name} fs${fontScale}: header shrank from ${previousHeight} to ${layout.expandedHeight}`
            );
          }
          previousHeight = layout.expandedHeight;
          previousCollapsible = layout.collapsible;
        }
      }
    }
  }
  // The cap has to actually do something, or this test proves nothing.
  const capped = getScreenHeaderLayout({
    availableWidth: 360,
    windowHeight: 780,
    topInset: 40,
    fontScale: 2,
    hasSubtitle: true,
    hasBack: true,
    actionCount: 0,
  });
  const atCap = getScreenHeaderLayout({
    availableWidth: 360,
    windowHeight: 780,
    topInset: 40,
    fontScale: MAX_FONT_SCALE,
    hasSubtitle: true,
    hasBack: true,
    actionCount: 0,
  });
  assert.equal(capped.expandedHeight, atCap.expandedHeight);
  assert.ok(atCap.titleLine > variantLineHeight.title, 'the cap should still scale text up');
});

test('the large title never intrudes on the back row', () => {
  for (const { label, input } of ALL) {
    const layout = getScreenHeaderLayout(input);
    assert.ok(
      layout.titleTop >= SCREEN_BAR_H,
      `${label}: large title starts at ${layout.titleTop}, inside the ${SCREEN_BAR_H}dp bar row`
    );
    assert.equal(layout.titleLeft, SCREEN_HEADER_GUTTER);
  }
});

test('the header never clips its own title mid-collapse', () => {
  // The failure this catches is exactly the one that was only visible on a
  // device: the resting geometry is fine at both ends and wrong in between.
  for (const { label, input } of ALL) {
    const layout = getScreenHeaderLayout(input);
    if (!layout.collapsible) continue;
    for (let y = 0; y <= layout.dist; y += 1) {
      const container = headerHeightAt(y, layout.dist, layout.maxHeight, layout.minHeight) - input.topInset;
      const { top, bottom } = titleBoundsAt(y, layout);
      assert.ok(top >= 0, `${label} @${y}: title top ${top.toFixed(1)} above the header`);
      assert.ok(
        bottom <= container,
        `${label} @${y}: title bottom ${bottom.toFixed(1)} below the header edge ${container.toFixed(1)}`
      );
    }
  }
});

test('the back label is gone before the title moves into its slot', () => {
  // Both sit at barTextLeft. Overlapping fades would show two strings dissolving
  // through each other in one spot — the crossfade this header replaces.
  for (const { label, input } of ALL) {
    const layout = getScreenHeaderLayout(input);
    if (!layout.collapsible || layout.travelX === 0) continue;
    for (let y = 0; y <= layout.dist; y += 1) {
      const labelVisible = labelOpacityAt(y, layout.settle) > 0;
      const titleArriving = titleSlideAt(y, layout.settle, layout.travelX) > 0;
      assert.ok(
        !(labelVisible && titleArriving),
        `${label} @${y}: back label and collapsed title share the slot`
      );
    }
  }
});

test('contentPaddingTop is the header height and nothing else derives it', () => {
  // The anti-regression test for the attempt that measured the header in one
  // place and re-declared it as list padding in another.
  for (const { label, input } of ALL) {
    const layout = getScreenHeaderLayout(input);
    assert.equal(
      layout.contentPaddingTop,
      input.topInset + layout.expandedHeight + layout.chromeHeight,
      `${label}: list padding disagrees with the header`
    );
    assert.equal(layout.maxHeight, layout.contentPaddingTop, `${label}: backdrop disagrees with the list`);
    assert.equal(layout.minHeight, input.topInset + layout.barHeight + layout.chromeHeight);
    // The chrome rides up with the collapse, so the list gains exactly the
    // distance the title travelled — no more, no less.
    assert.equal(layout.maxHeight - layout.minHeight, layout.dist, `${label}: collapse gain is wrong`);
  }
});

test('chrome is pinned below the title and never eats the title area', () => {
  for (const entry of WINDOWS) {
    const [width, height, topInset] = entry.portrait;
    const base = {
      availableWidth: width,
      windowHeight: height,
      topInset,
      fontScale: 1,
      hasSubtitle: false,
      hasBack: false,
      actionCount: 1,
    };
    const bare = getScreenHeaderLayout(base);
    const withChrome = getScreenHeaderLayout({ ...base, chromeHeight: 84 });
    // Chrome shifts what the list owes, but must not disturb the title's own
    // geometry or its travel — those are measured from the top, not the bottom.
    assert.equal(withChrome.expandedHeight, bare.expandedHeight, `${entry.name}: chrome moved the title area`);
    assert.equal(withChrome.dist, bare.dist, `${entry.name}: chrome changed the collapse distance`);
    assert.equal(withChrome.travelY, bare.travelY, `${entry.name}: chrome moved the travel`);
    assert.equal(withChrome.titleTop, bare.titleTop);
    assert.equal(
      withChrome.contentPaddingTop - bare.contentPaddingTop,
      84,
      `${entry.name}: chrome did not reach the list`
    );
  }
});

test('a screen whose destination is named elsewhere drops the bar entirely', () => {
  // Library in rail mode: the rail carries the word "Library", so a title row
  // would be the same word twice. The header becomes chrome and nothing else.
  for (const entry of WINDOWS) {
    for (const dims of [entry.portrait, entry.landscape]) {
      const [width, height, topInset] = dims;
      const layout = getScreenHeaderLayout({
        availableWidth: width,
        windowHeight: height,
        topInset,
        fontScale: 1,
        hasSubtitle: false,
        hasBack: false,
        actionCount: 1,
        hasTitle: false,
        chromeHeight: 84,
      });
      assert.equal(layout.hasTitle, false);
      assert.equal(layout.barHeight, 0, `${entry.name}: a titleless header still reserved a bar`);
      assert.equal(layout.expandedHeight, 0);
      assert.equal(layout.collapsible, false, `${entry.name}: nothing to collapse without a title`);
      assert.equal(layout.dist, 0);
      assert.equal(layout.contentPaddingTop, topInset + 84, `${entry.name}: list should clear only the chrome`);
      assert.equal(layout.maxHeight, layout.minHeight, `${entry.name}: a titleless header must not move`);
    }
  }
});

test('the chevron never moves', () => {
  const first = getScreenHeaderLayout(ALL[0]!.input);
  for (const { label, input } of ALL) {
    const layout = getScreenHeaderLayout(input);
    assert.equal(layout.chevronLeft, first.chevronLeft, `${label}: chevron moved horizontally`);
    assert.equal(layout.chevronSize, first.chevronSize, `${label}: chevron resized`);
    assert.equal(layout.barCenterY, input.topInset + SCREEN_BAR_H / 2, `${label}: chevron row moved`);
  }
});

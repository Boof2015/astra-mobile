import assert from 'node:assert/strict';
import test from 'node:test';
import { getEQLayout } from './eqLayout.ts';

/**
 * Inset-adjusted windows the EQ actually runs in. The screen measures window
 * minus safe areas, so these are what `getEQLayout` receives.
 */
const PHONE_PORTRAIT = { w: 412, h: 850 };
const PHONE_LANDSCAPE = { w: 915, h: 411 };
const SMALL_PHONE_LANDSCAPE = { w: 640, h: 340 };
const FOLD_COVER = { w: 340, h: 800 };
const FOLD_OPEN = { w: 840, h: 900 };
const TABLET_PORTRAIT = { w: 800, h: 1180 };
const TABLET_LANDSCAPE = { w: 1280, h: 800 };
/** A tablet in landscape with the player dock open — the dock takes 460dp. */
const TABLET_LANDSCAPE_DOCKED = { w: 820, h: 800 };

test('stacks the graph over the controls wherever there is height to do it', () => {
  for (const win of [
    PHONE_PORTRAIT,
    FOLD_COVER,
    FOLD_OPEN,
    TABLET_PORTRAIT,
    TABLET_LANDSCAPE,
    TABLET_LANDSCAPE_DOCKED,
  ]) {
    assert.equal(getEQLayout(win.w, win.h).panes, 'stacked', `${win.w}x${win.h}`);
  }
});

test('splits into two panes only where stacking would not fit', () => {
  // The rule is scarce height, not landscape: a tablet in landscape stacks.
  for (const win of [PHONE_LANDSCAPE, SMALL_PHONE_LANDSCAPE]) {
    assert.equal(getEQLayout(win.w, win.h).panes, 'split', `${win.w}x${win.h}`);
  }
  assert.equal(getEQLayout(TABLET_LANDSCAPE.w, TABLET_LANDSCAPE.h).panes, 'stacked');
});

test('never splits into a pane too narrow to edit in', () => {
  // A short *and* narrow window has no good answer; stacking cramped beats
  // splitting into something unusable.
  for (let width = 0; width < 600; width += 10) {
    assert.equal(getEQLayout(width, 380).panes, 'stacked', `width ${width}`);
  }
});

test('a phone sees exactly the editor it has today, in both orientations', () => {
  assert.equal(getEQLayout(PHONE_PORTRAIT.w, PHONE_PORTRAIT.h).editor, 'strip');
  assert.equal(getEQLayout(PHONE_LANDSCAPE.w, PHONE_LANDSCAPE.h).editor, 'strip');
  assert.equal(getEQLayout(FOLD_COVER.w, FOLD_COVER.h).editor, 'strip');
});

test('gives tablets and unfolded foldables the console', () => {
  for (const win of [FOLD_OPEN, TABLET_PORTRAIT, TABLET_LANDSCAPE, TABLET_LANDSCAPE_DOCKED]) {
    assert.equal(getEQLayout(win.w, win.h).editor, 'console', `${win.w}x${win.h}`);
  }
});

test('the console only appears where four strips and the add cell fit', () => {
  for (let width = 0; width <= 2000; width += 1) {
    for (const height of [400, 700, 1100]) {
      const layout = getEQLayout(width, height);
      if (layout.editor !== 'console') continue;
      const editorWidth = layout.panes === 'split' ? layout.sidePaneWidth : width - 32;
      const seated = (editorWidth - 56) / (layout.stripWidth + 8);
      assert.ok(
        seated >= 4,
        `${width}x${height} seats ${seated.toFixed(2)} strips in ${editorWidth}dp`
      );
    }
  }
});

test('a split pane never grows wide enough to hold a console', () => {
  // The console is a stacked-layout answer by construction: the side pane is
  // capped well below the console's minimum. If that ever stops being true the
  // two knobs would interact, which is exactly what this module exists to avoid.
  for (let width = 600; width <= 2000; width += 1) {
    const layout = getEQLayout(width, 400);
    assert.equal(layout.panes, 'split', `width ${width}`);
    assert.equal(layout.editor, 'strip', `width ${width}`);
  }
});

test('the console height is a sum of declared parts, rail included', () => {
  for (const win of [FOLD_OPEN, TABLET_PORTRAIT, TABLET_LANDSCAPE]) {
    const layout = getEQLayout(win.w, win.h);
    assert.equal(layout.consoleHeight - layout.railHeight, 156, `${win.w}x${win.h}`);
  }
});

test('shortens the gain rail rather than the graph on shorter windows', () => {
  const tall = getEQLayout(TABLET_PORTRAIT.w, TABLET_PORTRAIT.h);
  const short = getEQLayout(TABLET_LANDSCAPE.w, TABLET_LANDSCAPE.h);
  assert.ok(short.railHeight < tall.railHeight);
  assert.ok(short.consoleHeight < tall.consoleHeight);
});

test('both knobs are monotonic — growing a window never takes capability away', () => {
  let seenConsole = false;
  for (let width = 0; width <= 2000; width += 1) {
    const console_ = getEQLayout(width, 1000).editor === 'console';
    if (console_) seenConsole = true;
    assert.ok(!(seenConsole && !console_), `console lost again at width ${width}`);
  }
  let seenStacked = false;
  for (let height = 2000; height >= 0; height -= 1) {
    const stacked = getEQLayout(1280, height).panes === 'stacked';
    if (!stacked) seenStacked = true;
    assert.ok(!(seenStacked && stacked), `stacked again at height ${height}`);
  }
});

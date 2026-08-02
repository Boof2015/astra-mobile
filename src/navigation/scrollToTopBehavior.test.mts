import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ANIMATED_SCROLL_TOP_SCREENS,
  shouldAnimateScrollToTop,
} from './scrollToTopBehavior.ts';

const VIEWPORT = 800;
const LIMIT = VIEWPORT * ANIMATED_SCROLL_TOP_SCREENS;

test('a list near the top animates back', () => {
  assert.equal(shouldAnimateScrollToTop(0, VIEWPORT), true);
  assert.equal(shouldAnimateScrollToTop(VIEWPORT, VIEWPORT), true);
});

test('a list deep down jumps instead of smearing blank cells', () => {
  assert.equal(shouldAnimateScrollToTop(LIMIT + 1, VIEWPORT), false);
  assert.equal(shouldAnimateScrollToTop(120_000, VIEWPORT), false);
});

test('the boundary itself still animates', () => {
  assert.equal(shouldAnimateScrollToTop(LIMIT, VIEWPORT), true);
});

// The grid measures its width on first layout; height can arrive just as late.
test('an unmeasured viewport jumps rather than guessing', () => {
  assert.equal(shouldAnimateScrollToTop(10, 0), false);
  assert.equal(shouldAnimateScrollToTop(10, -1), false);
  assert.equal(shouldAnimateScrollToTop(10, Number.NaN), false);
});

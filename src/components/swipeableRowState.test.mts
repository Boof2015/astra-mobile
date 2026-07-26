import assert from 'node:assert/strict';
import test from 'node:test';

import { swipeLaneOpacity } from './swipeableRowState.ts';

test('swipe action lanes stay transparent while a row is resting', () => {
  assert.equal(swipeLaneOpacity(0, 'left'), 0);
  assert.equal(swipeLaneOpacity(0, 'right'), 0);
  assert.equal(swipeLaneOpacity(Number.NaN, 'left'), 0);
});

test('only the lane in the active swipe direction becomes visible', () => {
  assert.equal(swipeLaneOpacity(2, 'left'), 1);
  assert.equal(swipeLaneOpacity(2, 'right'), 0);
  assert.equal(swipeLaneOpacity(-2, 'left'), 0);
  assert.equal(swipeLaneOpacity(-2, 'right'), 1);
});

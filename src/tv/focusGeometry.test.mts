import assert from 'node:assert/strict';
import test from 'node:test';
import { anchoredStart, gridNeighbor, restoredIndex, shelfOffset } from './focusGeometry.ts';

test('incomplete grid uses the actual landing column (G -> J -> F)', () => {
  const j = gridNeighbor(6, 10, 4, 'down');
  assert.equal(j, 9);
  assert.equal(gridNeighbor(j, 10, 4, 'up'), 5);
});
test('grid edges do not wrap into another row', () => {
  assert.equal(gridNeighbor(3, 10, 4, 'right'), 3);
  assert.equal(gridNeighbor(4, 10, 4, 'left'), 4);
  assert.equal(gridNeighbor(9, 10, 4, 'down'), 9);
});
test('refresh restores identity and removal falls forward then backward', () => {
  assert.equal(restoredIndex(['c', 'b', 'a'], 'a', 0), 2);
  assert.equal(restoredIndex(['a', 'c'], 'b', 1), 1);
  assert.equal(restoredIndex(['a'], 'c', 2), 0);
  assert.equal(restoredIndex([], 'a', 0), 0);
});
test('scroll anchors clamp at both ends without moving a short collection', () => {
  assert.equal(anchoredStart(0, 20, 8, 3), 0);
  assert.equal(anchoredStart(10, 20, 8, 3), 7);
  assert.equal(anchoredStart(19, 20, 8, 3), 12);
  assert.equal(anchoredStart(2, 3, 8, 3), 0);
  assert.equal(shelfOffset(3, 4), 0);
  assert.ok(Math.abs(shelfOffset(9, 10) - 584.8) < .001);
});

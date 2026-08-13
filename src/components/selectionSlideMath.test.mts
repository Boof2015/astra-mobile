import assert from 'node:assert/strict';
import test from 'node:test';
import { isMeasured, resolveMark, type ItemRect } from './selectionSlideMath.ts';

/** A phone's bottom bar: four equal tabs across 412dp. */
const EQUAL_TABS = new Map<string, ItemRect>([
  ['index', { offset: 0, extent: 103 }],
  ['library', { offset: 103, extent: 103 }],
  ['eq', { offset: 206, extent: 103 }],
  ['settings', { offset: 309, extent: 103 }],
]);

test('places the mark on the selected item', () => {
  assert.deepEqual(resolveMark(EQUAL_TABS, 'eq'), { offset: 206, extent: 103 });
});

test('hides the mark when nothing is selected, rather than parking it on the first item', () => {
  // The regression this module exists for: `Math.max(0, findIndex(...))` used to
  // turn a -1 into slot 0, lighting Home while Home was not selected.
  assert.equal(resolveMark(EQUAL_TABS, null), null);
});

test('hides the mark for a key that is not among the items', () => {
  assert.equal(resolveMark(EQUAL_TABS, 'stats'), null);
});

test('hides the mark until the selected item has reported a layout', () => {
  const partial = new Map<string, ItemRect>([['index', { offset: 0, extent: 103 }]]);
  assert.equal(resolveMark(partial, 'settings'), null);
  assert.equal(resolveMark(new Map(), 'index'), null);
});

test('rejects a zero-extent layout pass as no measurement at all', () => {
  // A container reports its children at zero before it has been sized. Believing
  // it collapses the mark's box, and since the bar is centred in that box the
  // mark flashes half a tab to the left and slides back — the cold-boot flash.
  assert.equal(isMeasured({ offset: 0, extent: 103 }), true);
  assert.equal(isMeasured({ offset: 0, extent: 0 }), false);

  const unsized = new Map<string, ItemRect>([['index', { offset: 0, extent: 0 }]]);
  assert.equal(resolveMark(unsized, 'index'), null);
});

test('follows unequal item extents instead of dividing the container evenly', () => {
  // A split card while the dock is opening: items are mid-resize and the leading
  // inset is the card's own padding, so container/count would miss every slot.
  const splitCard = new Map<string, ItemRect>([
    ['index', { offset: 8, extent: 64 }],
    ['library', { offset: 72, extent: 88 }],
    ['eq', { offset: 160, extent: 64 }],
    ['settings', { offset: 224, extent: 72 }],
  ]);
  assert.deepEqual(resolveMark(splitCard, 'library'), { offset: 72, extent: 88 });
  assert.deepEqual(resolveMark(splitCard, 'settings'), { offset: 224, extent: 72 });
});

test('follows a rail column the same way it follows a row', () => {
  // Same contract on the other axis: offset/extent are y/height in a rail.
  const rail = new Map<string, ItemRect>([
    ['index', { offset: 0, extent: 52 }],
    ['library', { offset: 52, extent: 52 }],
  ]);
  assert.deepEqual(resolveMark(rail, 'library'), { offset: 52, extent: 52 });
});

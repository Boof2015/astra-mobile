import assert from 'node:assert/strict';
import test from 'node:test';
import { RAIL_LETTERS, railLettersForDirection } from '../../lib/letterIndex.ts';
import { alphabetRailIndexAt, getAlphabetRailLayout } from './alphabetRailLayout.ts';

test('a tall viewport retains the full-size alphabet', () => {
  const layout = getAlphabetRailLayout(700)!;
  assert.equal(layout.height, 467);
  assert.equal(layout.step, 17);
  assert.deepEqual(layout.labelIndices, RAIL_LETTERS.map((_, index) => index));
});

test('labels fit inside short and tall list viewports without overlapping', () => {
  for (const height of [80, 164, 242, 300, 420, 560, 700]) {
    for (const scale of [1, 1.2, 2]) {
      const layout = getAlphabetRailLayout(height, scale)!;
      assert.ok(layout.height <= height);
      assert.equal(layout.labelIndices[0], 0);
      assert.equal(layout.labelIndices.at(-1), RAIL_LETTERS.length - 1);
      let previousBottom = 0;
      for (const index of layout.labelIndices) {
        const top = layout.firstCenter + index * layout.step - layout.labelHeight / 2;
        assert.ok(top >= previousBottom - 0.001, `${height}dp/${scale}x: overlapping label ${index}`);
        previousBottom = top + layout.labelHeight;
        assert.ok(previousBottom <= layout.height + 0.001);
      }
    }
  }
});

test('scrubbing still reaches every letter, including dots, in either sort direction', () => {
  for (const height of [80, 164, 242, 300, 700]) {
    const layout = getAlphabetRailLayout(height)!;
    for (const direction of ['asc', 'desc'] as const) {
      const letters = railLettersForDirection(direction);
      for (let index = 0; index < letters.length; index++) {
        const y = layout.firstCenter + index * layout.step;
        for (const offset of [-0.4, 0, 0.4]) {
          assert.equal(letters[alphabetRailIndexAt(y + offset * layout.step, layout)], letters[index]);
        }
      }
      assert.equal(letters[alphabetRailIndexAt(-20, layout)], letters[0]);
      assert.equal(letters[alphabetRailIndexAt(layout.height + 20, layout)], letters.at(-1));
    }
    if (height < 467) assert.ok(layout.labelIndices.length < RAIL_LETTERS.length);
  }
});

test('unmeasured or unusable viewports do not render an overflowing rail', () => {
  for (const height of [0, -1, 32, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.equal(getAlphabetRailLayout(height), null);
  }
});

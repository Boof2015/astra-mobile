import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DEFAULT_LIBRARY_LAYOUT,
  LIBRARY_LAYOUT_OPTIONS,
  libraryGridColumns,
  libraryLayoutColumns,
  libraryLayoutLabel,
  parseLibraryLayout,
  type LibraryLayout,
} from './libraryLayout.ts';

/**
 * Content widths the grid actually gets, measured off the shell:
 * window width, minus the rail in landscape, minus the screen gutters.
 */
const PHONE_PORTRAIT = 380;
const PHONE_LANDSCAPE = 695;
const TABLET_LANDSCAPE = 1200;

test('defaults missing and invalid library layouts to the current three-column grid', () => {
  assert.equal(parseLibraryLayout(null), DEFAULT_LIBRARY_LAYOUT);
  assert.equal(parseLibraryLayout(''), DEFAULT_LIBRARY_LAYOUT);
  assert.equal(parseLibraryLayout('grid'), DEFAULT_LIBRARY_LAYOUT);
  assert.equal(parseLibraryLayout('grid-5'), DEFAULT_LIBRARY_LAYOUT);
});

test('restores every supported persisted library layout', () => {
  for (const option of LIBRARY_LAYOUT_OPTIONS) {
    assert.equal(parseLibraryLayout(option.value), option.value);
  }
});

test('maps list and grid layouts to their visible column counts and labels', () => {
  const expectations: Array<[LibraryLayout, number, string]> = [
    ['list', 1, 'List'],
    ['grid-2', 2, 'Large grid'],
    ['grid-3', 3, 'Medium grid'],
    ['grid-4', 4, 'Compact grid'],
  ];

  for (const [layout, columns, label] of expectations) {
    assert.equal(libraryLayoutColumns(layout), columns);
    assert.equal(libraryLayoutLabel(layout), label);
  }
});

test('a phone in portrait keeps exactly the column count the user picked', () => {
  // The whole point of the reference width: this is the verified layout, and
  // making the grid width-aware must not reflow it.
  for (const option of LIBRARY_LAYOUT_OPTIONS) {
    assert.equal(
      libraryGridColumns(option.value, PHONE_PORTRAIT),
      option.columns,
      `${option.value} reflowed in portrait`
    );
  }
});

test('narrower-than-reference windows never drop below the picked count', () => {
  for (const width of [200, 288, 320, 379]) {
    for (const option of LIBRARY_LAYOUT_OPTIONS) {
      assert.ok(
        libraryGridColumns(option.value, width) >= option.columns,
        `${option.value} lost columns at ${width}dp`
      );
    }
  }
});

test('landscape spends its extra width on more tiles, not bigger ones', () => {
  for (const option of LIBRARY_LAYOUT_OPTIONS) {
    if (option.columns <= 1) continue;
    const portrait = libraryGridColumns(option.value, PHONE_PORTRAIT);
    const landscape = libraryGridColumns(option.value, PHONE_LANDSCAPE);
    assert.ok(
      landscape > portrait,
      `${option.value} stayed at ${landscape} columns across a ${PHONE_PORTRAIT}→${PHONE_LANDSCAPE}dp change`
    );
    // Tiles stay near the size the preference implies rather than inflating.
    const portraitTile = PHONE_PORTRAIT / portrait;
    const landscapeTile = PHONE_LANDSCAPE / landscape;
    assert.ok(
      Math.abs(landscapeTile - portraitTile) / portraitTile < 0.2,
      `${option.value} tiles went ${portraitTile.toFixed(0)}dp → ${landscapeTile.toFixed(0)}dp`
    );
  }
});

test('a list stays one column at every width', () => {
  for (const width of [PHONE_PORTRAIT, PHONE_LANDSCAPE, TABLET_LANDSCAPE]) {
    assert.equal(libraryGridColumns('list', width), 1);
  }
});

test('column count is capped so a wide window cannot shred the grid', () => {
  for (const option of LIBRARY_LAYOUT_OPTIONS) {
    assert.ok(libraryGridColumns(option.value, 4000) <= 8);
  }
});

test('falls back to the picked count before the grid has been measured', () => {
  for (const width of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
    for (const option of LIBRARY_LAYOUT_OPTIONS) {
      assert.equal(libraryGridColumns(option.value, width), option.columns);
    }
  }
});

test('every width produces a usable finite column count', () => {
  for (let width = 0; width <= 2000; width += 7) {
    for (const option of LIBRARY_LAYOUT_OPTIONS) {
      const columns = libraryGridColumns(option.value, width);
      assert.ok(Number.isInteger(columns), `${option.value} @ ${width} → ${columns}`);
      assert.ok(columns >= 1 && columns <= 8, `${option.value} @ ${width} → ${columns}`);
    }
  }
});

import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DEFAULT_LIBRARY_LAYOUT,
  LIBRARY_LAYOUT_OPTIONS,
  libraryLayoutColumns,
  libraryLayoutLabel,
  parseLibraryLayout,
  type LibraryLayout,
} from './libraryLayout.ts';

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

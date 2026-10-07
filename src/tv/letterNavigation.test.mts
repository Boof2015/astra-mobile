import assert from 'node:assert/strict';
import test from 'node:test';
import { heldPage, heldSection, nextAvailableLetter, tvSectionLabel } from './letterNavigation.ts';
import { gridNeighbor } from './focusGeometry.ts';

test('letters agree with native catalog labels, including accents and punctuation', () => {
  for (const [title, label] of [[' Élan', 'E'], ['Saturn', 'S'], ['7 Rings', '#'], ['! PARTY', '#'], ['東京', '#'], ['', '#']]) {
    assert.equal(tvSectionLabel(title), label);
  }
});
test('empty picker cells jump forward without wrapping; # is selectable', () => {
  assert.equal(nextAvailableLetter('B', ['A', 'F', 'T']), 'F');
  assert.equal(nextAvailableLetter('F', ['A', 'F', 'T']), 'F');
  assert.equal(nextAvailableLetter('Z', ['A', 'F', 'T']), null);
  assert.equal(nextAvailableLetter('Z', ['#', 'A']), '#');
  assert.equal(nextAvailableLetter('#', ['#', 'A']), '#');
  assert.equal(nextAvailableLetter('A', []), null);
});
test('hold goes to section starts in catalog order and stops at both ends', () => {
  const labels = ['#', 'A', 'F', 'Z'];
  assert.equal(heldSection(labels, 'F', 'up', false), 'F');
  assert.equal(heldSection(labels, 'F', 'up', true), 'A');
  assert.equal(heldSection(labels, 'F', 'down', false), 'Z');
  assert.equal(heldSection(labels, 'F', 'down', true), 'Z');
  assert.equal(heldSection(labels, '#', 'up', true), null);
  assert.equal(heldSection(labels, 'Z', 'down', true), null);
});
test('nonalphabetical hold moves by pages and handles a partial final page', () => {
  assert.equal(heldPage(10, 35, 8, 'up'), 8);
  assert.equal(heldPage(8, 35, 8, 'up'), 0);
  assert.equal(heldPage(10, 35, 8, 'down'), 16);
  assert.equal(heldPage(31, 35, 8, 'down'), 32);
  assert.equal(heldPage(34, 35, 8, 'down'), 34);
  assert.equal(heldPage(0, 35, 8, 'up'), 0);
  assert.equal(heldPage(8, 35, 12, 'down'), 12);
});
test('letter picker stops at row ends and uses actual columns on its short final row', () => {
  assert.equal(gridNeighbor(6, 27, 7, 'right'), 6);
  assert.equal(gridNeighbor(20, 27, 7, 'down'), 26);
  assert.equal(gridNeighbor(26, 27, 7, 'up'), 19);
  assert.equal(gridNeighbor(21, 27, 7, 'left'), 21);
});

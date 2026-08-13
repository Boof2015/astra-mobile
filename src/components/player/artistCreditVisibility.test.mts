import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveVisibleArtistCreditCount } from './artistCreditVisibility.ts';

test('does not add an overflow action when every artist fits', () => {
  assert.equal(
    resolveVisibleArtistCreditCount({
      artistCount: 2,
      availableWidth: 180,
      prefixWidths: { 1: 70, 2: 140 },
      moreLabelWidths: { 1: 58 },
    }),
    2
  );
});

test('keeps the largest prefix that fits beside the overflow action', () => {
  assert.equal(
    resolveVisibleArtistCreditCount({
      artistCount: 4,
      availableWidth: 190,
      prefixWidths: { 1: 55, 2: 120, 3: 185, 4: 250 },
      moreLabelWidths: { 1: 58, 2: 58, 3: 58 },
    }),
    2
  );
});

test('keeps the overflow action visible when the first artist is very long', () => {
  assert.equal(
    resolveVisibleArtistCreditCount({
      artistCount: 3,
      availableWidth: 120,
      prefixWidths: { 1: 180, 2: 240, 3: 300 },
      moreLabelWidths: { 1: 58, 2: 58 },
    }),
    1
  );
});

test('waits for measurements before changing the credit', () => {
  assert.equal(
    resolveVisibleArtistCreditCount({
      artistCount: 3,
      availableWidth: 180,
      prefixWidths: {},
      moreLabelWidths: {},
    }),
    3
  );
});

test('never offers an overflow tray for a single artist', () => {
  assert.equal(
    resolveVisibleArtistCreditCount({
      artistCount: 1,
      availableWidth: 20,
      prefixWidths: { 1: 200 },
      moreLabelWidths: {},
    }),
    1
  );
});

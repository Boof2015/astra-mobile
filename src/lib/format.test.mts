import assert from 'node:assert/strict';
import test from 'node:test';
import { formatCollectionDuration, formatDuration } from './format.ts';

test('durations below an hour use minutes and padded seconds', () => {
  assert.equal(formatDuration(0), '0:00');
  assert.equal(formatDuration(9), '0:09');
  assert.equal(formatDuration(60), '1:00');
  assert.equal(formatDuration(271.3), '4:31');
  assert.equal(formatDuration(3599), '59:59');
});

test('long durations use unbounded hours and padded minutes and seconds', () => {
  assert.equal(formatDuration(3600), '1:00:00');
  assert.equal(formatDuration(3661), '1:01:01');
  assert.equal(formatDuration(4389), '1:13:09');
  assert.equal(formatDuration(86400), '24:00:00');
  assert.equal(formatDuration(20390 * 60 + 12), '339:50:12');
});

test('fractional seconds truncate without rounding across an hour boundary', () => {
  assert.equal(formatDuration(0.9), '0:00');
  assert.equal(formatDuration(3599.999), '59:59');
  assert.equal(formatDuration(3600.999), '1:00:00');
  assert.equal(formatDuration(3661.9), '1:01:01');
});

test('invalid and negative durations display zero', () => {
  for (const seconds of [NaN, Infinity, -Infinity, -1, -0.5]) {
    assert.equal(formatDuration(seconds), '0:00');
  }
});

test('collection totals use hours and minutes without seconds or day rollover', () => {
  assert.equal(formatCollectionDuration(271.3), '4 min');
  assert.equal(formatCollectionDuration(3599.999), '59 min');
  assert.equal(formatCollectionDuration(3600), '1 hr');
  assert.equal(formatCollectionDuration(3661.9), '1 hr 1 min');
  assert.equal(formatCollectionDuration(86400), '24 hr');
  assert.equal(formatCollectionDuration(20390 * 60 + 12), '339 hr 50 min');
});

test('collection totals distinguish under a minute from empty or invalid durations', () => {
  assert.equal(formatCollectionDuration(0.5), '<1 min');
  assert.equal(formatCollectionDuration(59.999), '<1 min');
  assert.equal(formatCollectionDuration(60), '1 min');
  for (const seconds of [0, -1, NaN, Infinity, -Infinity]) {
    assert.equal(formatCollectionDuration(seconds), '0 min');
  }
});

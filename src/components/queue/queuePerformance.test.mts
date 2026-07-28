import assert from 'node:assert/strict';
import test from 'node:test';
import {
  QUEUE_RENDER_AHEAD_MIN_ROWS,
  QUEUE_RENDER_WINDOW_MULTIPLIER,
  QUEUE_ROW_HEIGHT,
  queuePreviewRowCount,
  queueRenderDistance,
} from './queuePerformance.ts';

test('queue render-ahead covers two windows with a twelve-row minimum', () => {
  assert.equal(QUEUE_RENDER_AHEAD_MIN_ROWS, 12);
  assert.equal(QUEUE_RENDER_WINDOW_MULTIPLIER, 2);
  assert.equal(queueRenderDistance(780), 1560);
  assert.equal(queueRenderDistance(320), QUEUE_ROW_HEIGHT * 12);
  assert.equal(queueRenderDistance(0), QUEUE_ROW_HEIGHT * 12);
  assert.equal(queueRenderDistance(Number.NaN), QUEUE_ROW_HEIGHT * 12);
});

test('initial queue preview covers the sheet viewport without duplicating a screen', () => {
  assert.equal(queuePreviewRowCount(780), 4);
  assert.equal(queuePreviewRowCount(900), 5);
  assert.equal(queuePreviewRowCount(1400), 6);
});

test('queue preview remains safe for unusually short windows', () => {
  assert.equal(queuePreviewRowCount(0), 1);
  assert.equal(queuePreviewRowCount(320), 1);
});

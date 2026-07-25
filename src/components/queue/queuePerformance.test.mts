import assert from 'node:assert/strict';
import test from 'node:test';
import {
  QUEUE_RENDER_AHEAD_ROWS,
  QUEUE_RENDER_DISTANCE,
  QUEUE_ROW_HEIGHT,
  queuePreviewRowCount,
} from './queuePerformance.ts';

test('queue render-ahead stays bounded to four rows', () => {
  assert.equal(QUEUE_RENDER_AHEAD_ROWS, 4);
  assert.equal(QUEUE_RENDER_DISTANCE, QUEUE_ROW_HEIGHT * 4);
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

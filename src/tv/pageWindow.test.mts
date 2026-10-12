import assert from 'node:assert/strict';
import test from 'node:test';
import { readTvWindow } from './pageWindow.ts';

test('refresh retains the loaded window after a removal beyond the first page', async () => {
  const items = Array.from({ length: 299 }, (_, i) => i < 180 ? i : i + 1);
  const calls: (string | null)[] = [];
  const result = await readTvWindow(async cursor => {
    calls.push(cursor); const offset = Number(cursor ?? 0);
    return { items: items.slice(offset, offset + 120), totalCount: items.length, nextCursor: offset + 120 < items.length ? String(offset + 120) : null };
  }, null, 240, () => true);
  assert.equal(result?.replace, true);
  assert.deepEqual(calls, [null, '120']);
  assert.equal(result?.page.items[180], 181);
  assert.equal(result?.page.items.length, 240);
  assert.equal(result?.page.nextCursor, '240');
});
test('a stale append restarts and fills the previous window atomically', async () => {
  const calls: (string | null)[] = [];
  const result = await readTvWindow(async cursor => {
    calls.push(cursor);
    return cursor === 'old' ? { items: [], totalCount: 0, nextCursor: null, error: 'STALE_REVISION' }
      : { items: cursor ? [3, 4] : [1, 2], totalCount: 4, nextCursor: cursor ? null : 'new' };
  }, 'old', 4, () => true);
  assert.deepEqual(calls, ['old', null, 'new']);
  assert.equal(result?.replace, true);
  assert.deepEqual(result?.page.items, [1, 2, 3, 4]);
});
test('cancellation after a source change does not publish or request another page', async () => {
  let current = true; let calls = 0;
  const result = await readTvWindow(async () => {
    calls++; current = false;
    return { items: [1], totalCount: 10, nextCursor: 'next' };
  }, null, 10, () => current);
  assert.equal(result, null); assert.equal(calls, 1);
});
test('ordinary append preserves append semantics', async () => {
  const result = await readTvWindow(async () => ({ items: [3, 4], totalCount: 4, nextCursor: null }), 'next', 2, () => true);
  assert.equal(result?.replace, false); assert.deepEqual(result?.page.items, [3, 4]);
});
test('a refreshed letter window retains its first backward cursor across forward reads', async () => {
  const result = await readTvWindow(async cursor => ({ items: cursor ? [5, 6] : [3, 4], totalCount: 10,
    previousCursor: cursor ? 'middle' : 'before-window', nextCursor: cursor ? 'after-window' : 'middle' }), null, 4, () => true);
  assert.deepEqual(result?.page.items, [3, 4, 5, 6]);
  assert.equal(result?.page.previousCursor, 'before-window');
  assert.equal(result?.page.nextCursor, 'after-window');
});
test('a repeatedly stale catalog stops after one restart', async () => {
  let calls = 0;
  await assert.rejects(readTvWindow(async () => {
    calls++; return { items: [], totalCount: 0, nextCursor: null, error: 'STALE_REVISION' };
  }, 'old', 2, () => true), /library changed/);
  assert.equal(calls, 2);
});
test('a broken cursor or failed refresh cannot publish a partial list', async () => {
  await assert.rejects(readTvWindow(async () => ({ items: [1], totalCount: 50, nextCursor: 'same' }), null, 50, () => true), /continue loading/);
  await assert.rejects(readTvWindow(async cursor => ({ items: [1], totalCount: 3, nextCursor: 'next', ...(cursor ? { error: 'Storage unavailable' } : {}) }), null, 3, () => true), /Storage unavailable/);
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { createPlaylistReorder } from './playlistReorder.ts';

const tick = () => new Promise<void>(resolve => setImmediate(resolve));
function deferred() { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { promise, resolve }; }
function fixture(values = ['a', 'b', 'c', 'd'], size = 120) {
  const stored = [...values]; const writes: string[] = []; const reads: number[] = []; const errors: unknown[] = [];
  const page = (offset: number) => ({ items: stored.slice(offset, offset + size), totalCount: stored.length, nextCursor: offset + size < stored.length ? String(offset + size) : null });
  const options = { initial: page(0), focusedKey: values[0], keyOf: (id: string) => id,
    read: async (cursor: string) => { reads.push(Number(cursor)); return page(Number(cursor)); },
    write: async (key: string, direction: -1 | 1) => { writes.push(`${key}:${direction}`); const i = stored.indexOf(key); [stored[i], stored[i + direction]] = [stored[i + direction], stored[i]]; },
    changed: () => {}, failed: (error: unknown) => { errors.push(error); },
  };
  return { stored, writes, reads, errors, options, make: () => createPlaylistReorder(options) };
}

test('OK must pick up before directions can change saved order; drop keeps it', async () => {
  const f = fixture(); const session = f.make();
  session.move(1); await tick(); assert.deepEqual(f.writes, []);
  session.toggleGrab(); session.move(1); await tick(); session.drop();
  session.move(1); await tick();
  assert.deepEqual(session.snapshot().items, ['b', 'a', 'c', 'd']);
  assert.deepEqual(f.stored, session.snapshot().items);
  assert.equal(session.snapshot().focusedKey, 'a'); assert.equal(session.snapshot().grabbed, false);
});
test('rapid directions stay serialized and finishing waits for every accepted move', async () => {
  const f = fixture(); const gate = deferred(); let calls = 0;
  const session = createPlaylistReorder({ ...f.options, write: async (key, direction) => { if (++calls === 1) await gate.promise; await f.options.write(key, direction); } });
  session.toggleGrab(); session.move(1); session.move(1); session.move(-1);
  const done = session.finish(); let finished = false; void done.then(() => { finished = true; });
  await tick(); assert.equal(calls, 1); assert.equal(finished, false);
  assert.deepEqual(session.snapshot().items, ['a', 'b', 'c', 'd']);
  session.move(1); // ignored after finish starts
  gate.resolve(); const result = await done;
  assert.deepEqual(f.writes, ['a:1', 'a:1', 'a:-1']);
  assert.deepEqual(result.items, ['b', 'a', 'c', 'd']); assert.deepEqual(result.items, f.stored);
});
test('a picked row crosses a page boundary without skipping the first unloaded neighbor', async () => {
  const f = fixture(['a', 'b', 'c', 'd', 'e'], 2); const session = f.make();
  session.focus('b'); session.toggleGrab(); session.move(1); session.move(1);
  const result = await session.finish();
  assert.deepEqual(f.reads, [2]); assert.deepEqual(result.items, ['a', 'c', 'd', 'b']);
  assert.equal(result.nextCursor, '4'); assert.equal(result.totalCount, 5);
  assert.deepEqual(f.stored, ['a', 'c', 'd', 'b', 'e']);
});
test('edges stop without native writes or wraparound', async () => {
  const f = fixture(['a', 'b']); const session = f.make();
  session.toggleGrab(); session.move(-1); await tick(); assert.deepEqual(f.writes, []);
  session.move(1); session.move(1); const result = await session.finish();
  assert.deepEqual(f.writes, ['a:1']); assert.deepEqual(result.items, ['b', 'a']);
});
test('failure preserves acknowledged moves, drops the row and discards later queued moves', async () => {
  const f = fixture(); let calls = 0;
  const session = createPlaylistReorder({ ...f.options, write: async (key, direction) => { if (++calls === 2) throw new Error('Storage unavailable'); await f.options.write(key, direction); } });
  session.toggleGrab(); session.move(1); session.move(1); session.move(1);
  const result = await session.finish();
  assert.equal(calls, 2); assert.equal(f.errors.length, 1); assert.equal(session.snapshot().grabbed, false);
  assert.deepEqual(result.items, ['b', 'a', 'c', 'd']); assert.deepEqual(f.stored, result.items);
});
test('a concurrently changed page cannot be merged or used for an incorrect move', async () => {
  const f = fixture(['a', 'b', 'c'], 2);
  const session = createPlaylistReorder({ ...f.options, read: async () => ({ items: ['d'], totalCount: 4, nextCursor: null }) });
  session.focus('b'); session.toggleGrab(); session.move(1); const result = await session.finish();
  assert.equal(f.errors.length, 1); assert.deepEqual(f.writes, []); assert.deepEqual(result.items, ['a', 'b']);
});
test('prefetch and row moves share one worker and preserve adjacent order', async () => {
  const f = fixture(['a', 'b', 'c', 'd'], 2); const gate = deferred();
  const session = createPlaylistReorder({ ...f.options, read: async cursor => { await gate.promise; return f.options.read(cursor); } });
  session.loadMore(); await tick(); session.toggleGrab(); session.move(1); session.move(1);
  await tick(); assert.deepEqual(f.writes, []); gate.resolve();
  const result = await session.finish(); assert.deepEqual(result.items, ['b', 'c', 'a', 'd']);
});
test('unmount cancels queued work and suppresses publication of an in-flight result', async () => {
  const f = fixture(); const gate = deferred(); let publications = 0;
  const session = createPlaylistReorder({ ...f.options, changed: () => { publications++; }, write: async (key, direction) => { await gate.promise; await f.options.write(key, direction); } });
  session.toggleGrab(); session.move(1); session.move(1); await tick(); session.dispose();
  const before = publications; gate.resolve(); await tick();
  assert.equal(publications, before); assert.deepEqual(f.writes, ['a:1']);
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { createSectionJumpCoordinator, prepareSectionJump, type SectionJumpPage } from './sectionJump.ts';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

function harness() {
  const coordinator = createSectionJumpCoordinator<string>();
  const reads: string[] = [];
  const commits: string[] = [];
  const pendingReads: ReturnType<typeof deferred<string | null>>[] = [];
  const unavailable: string[] = [];
  let revision = 0;
  return {
    coordinator, reads, commits, pendingReads, unavailable,
    jump(key: string) {
      return coordinator.request({
        key,
        prepare: () => {
          reads.push(key);
          const read = deferred<string | null>();
          pendingReads.push(read);
          return read.promise;
        },
        apply: (value) => { commits.push(value); return ++revision; },
        onUnavailable: () => { unavailable.push(key); },
      });
    },
    ready() { coordinator.ready(revision); },
  };
}

test('starts immediately and coalesces A → M → Z → B into A and B reads', async () => {
  const h = harness();
  const a = h.jump('A');
  assert.deepEqual(h.reads, ['A']);
  const m = h.jump('M');
  const z = h.jump('Z');
  const b = h.jump('B');
  assert.deepEqual(await Promise.all([a, m, z]), [false, false, false]);
  h.pendingReads[0].resolve('A');
  await tick();
  assert.deepEqual(h.reads, ['A', 'B']);
  assert.deepEqual(h.commits, []);
  h.pendingReads[1].resolve('B');
  assert.equal(await b, true);
  assert.deepEqual(h.commits, ['B']);
});

test('a cached destination bypasses an obsolete read without another native request', async () => {
  const h = harness();
  const a = h.jump('A');
  h.pendingReads[0].resolve('A');
  await a;
  h.ready();
  const m = h.jump('M');
  const cached = h.jump('A');
  assert.equal(await m, false);
  assert.equal(await cached, true);
  assert.deepEqual(h.commits, ['A', 'A']);
  h.pendingReads[1].resolve('M');
  await tick();
  assert.deepEqual(h.commits, ['A', 'A']);
  assert.deepEqual(h.reads, ['A', 'M']);
});

test('a mounting list keeps only the latest intent and ignores stale onLoad events', async () => {
  const h = harness();
  h.coordinator.mounting(10);
  const a = h.jump('A');
  h.pendingReads[0].resolve('A');
  await tick();
  assert.deepEqual(h.commits, []);
  const b = h.jump('B');
  assert.equal(await a, false);
  h.pendingReads[1].resolve('B');
  await tick();
  h.coordinator.ready(9);
  assert.deepEqual(h.commits, []);
  h.coordinator.ready(10);
  assert.equal(await b, true);
  assert.deepEqual(h.commits, ['B']);
});

test('the cache retains four windows and evicts the least recently used', async () => {
  const h = harness();
  for (const key of ['A', 'B', 'C', 'D']) {
    const result = h.jump(key);
    h.pendingReads.at(-1)!.resolve(key);
    await result;
    h.ready();
  }
  assert.equal(await h.jump('A'), true);
  h.ready();
  const e = h.jump('E');
  h.pendingReads.at(-1)!.resolve('E');
  await e;
  h.ready();
  const b = h.jump('B');
  assert.deepEqual(h.reads, ['A', 'B', 'C', 'D', 'E', 'B']);
  h.pendingReads.at(-1)!.resolve('B');
  await b;
});

test('cancellation clears cache, invalidates reads, and retains the one-read limit', async () => {
  const h = harness();
  const old = h.jump('A');
  h.coordinator.cancel();
  assert.equal(await old, false);
  const fresh = h.jump('A');
  assert.deepEqual(h.reads, ['A']);
  h.pendingReads[0].resolve('old A');
  await tick();
  assert.deepEqual(h.commits, []);
  assert.deepEqual(h.reads, ['A', 'A']);
  h.pendingReads[1].resolve('fresh A');
  assert.equal(await fresh, true);
  h.coordinator.cancel();
  const uncached = h.jump('A');
  assert.equal(h.reads.length, 3);
  h.pendingReads[2].resolve('fresh A');
  await uncached;
});

test('a cache hit waiting for a mount survives an obsolete read filling the cache', async () => {
  const h = harness();
  for (const key of ['A', 'B', 'C', 'D']) {
    const result = h.jump(key);
    h.pendingReads.at(-1)!.resolve(key);
    await result;
    h.ready();
  }
  h.coordinator.mounting(20);
  const obsolete = h.jump('E');
  const latest = h.jump('A');
  assert.equal(await obsolete, false);
  h.pendingReads.at(-1)!.resolve('E');
  await tick();
  h.coordinator.ready(20);
  assert.equal(await latest, true);
  assert.deepEqual(h.reads, ['A', 'B', 'C', 'D', 'E']);
});

test('revisiting the currently loading letter shares its preparation', async () => {
  const h = harness();
  const first = h.jump('A');
  const middle = h.jump('B');
  const last = h.jump('A');
  h.pendingReads[0].resolve('A');
  assert.deepEqual(await Promise.all([first, middle, last]), [false, false, true]);
  assert.deepEqual(h.reads, ['A']);
});

test('failed and throwing preparations leave the window intact and allow retry', async () => {
  const h = harness();
  for (const fail of ['empty', 'throw']) {
    const result = h.jump('A');
    if (fail === 'empty') h.pendingReads.at(-1)!.resolve(null);
    else h.pendingReads.at(-1)!.reject(new Error('native failure'));
    assert.equal(await result, false);
  }
  assert.deepEqual(h.commits, []);
  assert.deepEqual(h.unavailable, ['A', 'A']);
  const retry = h.jump('A');
  h.pendingReads.at(-1)!.resolve('A');
  assert.equal(await retry, true);
});

function page(items: string[], changes: Partial<SectionJumpPage<string>> = {}): SectionJumpPage<string> {
  return { items, nextCursor: null, previousCursor: null, totalCount: 1000, catalogRevision: '4', ...changes };
}
const prepare = (forward: SectionJumpPage<string>, backward: SectionJumpPage<string>) =>
  prepareSectionJump(async () => forward, async () => backward, (value) => value);

test('preserves the complete 200-row runway and both pagination cursors', async () => {
  const before = Array.from({ length: 200 }, (_, i) => `before ${i}`);
  const forward = Array.from({ length: 200 }, (_, i) => `after ${i}`);
  const window = await prepare(page(forward, { nextCursor: 'next' }), page(before, { previousCursor: 'previous' }));
  assert.deepEqual(window, {
    items: [...before, ...forward], nextCursor: 'next', previousCursor: 'previous',
    totalCount: 1000, anchorIndex: 200,
  });
});

test('the actual head accepts an empty successful backward page', async () => {
  assert.equal((await prepare(page(['A']), page([])))?.anchorIndex, 0);
});

test('rejects stale, missing, overlapping and inconsistent page halves', async () => {
  for (const before of [
    page(['B'], { error: 'STALE_REVISION' }),
    page(['B'], { catalogRevision: '5' }),
    page(['B'], { totalCount: 999 }),
    page(['C']),
    page([], { previousCursor: 'more above' }),
    page(['B'], { previousCursor: undefined }),
    null,
  ]) {
    assert.equal(await prepare(page(['C']), before as SectionJumpPage<string>), null);
  }
  assert.equal(await prepare(page([]), page(['B'])), null);
  assert.equal(await prepare(page(['C'], { error: 'STALE_REVISION' }), page(['B'])), null);
});

test('a rejection still waits for the other native read to finish', async () => {
  const forward = deferred<SectionJumpPage<string>>();
  let finished = false;
  const result = prepareSectionJump(
    () => forward.promise,
    async () => { throw new Error('backward failed'); },
    (value) => value,
  ).then((window) => { finished = true; return window; });
  await tick();
  assert.equal(finished, false);
  forward.resolve(page(['C']));
  assert.equal(await result, null);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { AnalysisCoordinator, type AnalysisAttempt } from './analysisCoordinator.ts';

const tick = () => new Promise<void>((resolve) => setImmediate(resolve));
const foreground = { peaks: true, priority: 'interactive' as const };
const background = { peaks: true, priority: 'prefetch' as const };

function fixture() {
  const started: AnalysisAttempt[] = [];
  const finishes: (() => void)[] = [];
  const queue = new AnalysisCoordinator<string | null>((attempt) => {
    if (attempt.signal.aborted) return Promise.resolve(null);
    started.push(attempt);
    return new Promise((resolve) => finishes.push(() => {
      attempt.acknowledgeRequirements();
      resolve(attempt.path);
    }));
  }, () => null);
  return { queue, started, finishes };
}

test('one prefetch leaves capacity for the current song; queued work stays ordered', async () => {
  const { queue, started, finishes } = fixture();
  const a = queue.request('a', background);
  const b = queue.request('b', background);
  const c = queue.request('c', foreground);
  await tick();
  assert.deepEqual(started.map((a) => a.path), ['a', 'c']);
  finishes[0](); await a; await tick();
  assert.deepEqual(started.map((a) => a.path), ['a', 'c', 'b']);
  finishes[1](); finishes[2](); await Promise.all([b, c]);
});

test('running prefetch promotion preserves the attempt and merged requirements', async () => {
  const { queue, started, finishes } = fixture();
  const a = queue.request('a', { ...background, peaks: false });
  await tick();
  const joined = queue.request('a', { ...foreground, durationMs: 120000 });
  assert.equal(joined, a);
  assert.equal(started[0].promoted, true);
  assert.equal(started[0].requirements.peaks, true);
  assert.equal(started[0].requirements.durationMs, 120000);
  assert.equal(started[0].signal.aborted, false);
  finishes[0](); assert.equal(await a, 'a');
  assert.equal(started.length, 1);
});

test('queued promotion overtakes other prefetch without starting two copies', async () => {
  const { queue, started, finishes } = fixture();
  const a = queue.request('a', background);
  const b = queue.request('b', background);
  const c = queue.request('c', background);
  assert.equal(queue.request('c', foreground), c);
  await tick();
  assert.deepEqual(started.map((a) => a.path), ['a', 'c']);
  finishes[0](); finishes[1](); await Promise.all([a, c]); await tick();
  finishes[2](); await b;
});

test('A → B → A waits for A teardown then starts a new identifiable attempt', async () => {
  const { queue, started, finishes } = fixture();
  const a = queue.request('a', foreground); await tick();
  const b = queue.request('b', foreground);
  assert.equal(started[0].signal.aborted, true);
  const returned = queue.request('a', foreground);
  assert.equal(returned, a);
  assert.equal(await b, null);
  assert.equal(queue.isCurrentAttempt('a', started[0].id), false);
  await tick(); assert.equal(started.length, 1);
  finishes[0](); await tick();
  assert.equal(started.length, 2);
  assert.notEqual(started[0].id, started[1].id);
  assert.equal(queue.isCurrentAttempt('a', started[1].id), true);
  finishes[1](); assert.equal(await returned, 'a');
});

test('latest cached/remote intent cancels obsolete work without a new decode', async () => {
  const { queue, started, finishes } = fixture();
  const a = queue.request('a', foreground); await tick();
  queue.setCurrentPath('cached');
  assert.equal(queue.isCurrentPath('a'), false);
  assert.equal(queue.isCurrentPath('cached'), true);
  assert.equal(started[0].signal.aborted, true);
  finishes[0](); assert.equal(await a, null);
  assert.deepEqual(queue.paths(), []);
});

test('cancelled preparation cannot block an otherwise free foreground slot', async () => {
  const { queue, started, finishes } = fixture();
  const a = queue.request('a', foreground); await tick();
  const b = queue.request('b', foreground); await tick();
  assert.deepEqual(started.map((attempt) => attempt.path), ['a', 'b']);
  assert.equal(started[0].signal.aborted, true);
  finishes[1](); assert.equal(await b, 'b');
  finishes[0](); assert.equal(await a, null);
});

test('reconciliation cancels removals and changes pending prefetch order', async () => {
  const { queue, started, finishes } = fixture();
  const a = queue.request('a', background);
  const b = queue.request('b', background);
  const c = queue.request('c', background);
  const d = queue.request('d', background);
  queue.reconcilePrefetch(['d', 'a', 'c']);
  assert.equal(await b, null);
  await tick(); finishes[0](); await a; await tick();
  assert.equal(started[1].path, 'd');
  finishes[1](); await d; await tick();
  finishes[2](); await c;
});

test('cache clear cancels preparation and keeps native ownership until it drains', async () => {
  const { queue, started, finishes } = fixture();
  const a = queue.request('a', foreground);
  const b = queue.request('b', background);
  const c = queue.request('c', background);
  await tick(); queue.cancelAll();
  assert.equal(await c, null);
  assert.ok(started.every((attempt) => attempt.signal.aborted));
  const fresh = queue.request('a', foreground);
  await tick(); assert.equal(started.length, 2);
  finishes[0](); finishes[1](); await b; await tick();
  assert.equal(started.length, 3);
  assert.equal(queue.isCurrentAttempt('a', started[0].id), false);
  finishes[2](); assert.equal(await fresh, 'a'); assert.equal(await a, 'a');
});

test('errors release capacity and stale completion cannot clear a newer attempt', async () => {
  let calls = 0;
  const queue = new AnalysisCoordinator(async () => {
    if (++calls === 1) throw new Error('failed');
    return 'ok';
  }, () => 'cancelled');
  await assert.rejects(queue.request('a', foreground), /failed/);
  assert.equal(await queue.request('a', foreground), 'ok');
});

test('a waveform request arriving after a loudness-only cache decision gets a follow-up', async () => {
  const { queue, started, finishes } = fixture();
  const first = queue.request('a', { ...foreground, peaks: false });
  await tick();
  finishes[0](); // Decision made; promise completion still queued as a microtask.
  const waveform = queue.request('a', foreground);
  assert.equal(first, waveform);
  await tick();
  assert.equal(started.length, 2);
  assert.equal(started[1].requirements.peaks, true);
  finishes[1](); assert.equal(await waveform, 'a');
});

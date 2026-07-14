import assert from 'node:assert/strict';
import test from 'node:test';
import { CacheInvalidationGate } from './cacheInvalidation.ts';

test('cache invalidation deletes after an already-running write', async () => {
  const gate = new CacheInvalidationGate();
  const generation = gate.capture();
  const actions: string[] = [];
  let releaseWrite!: () => void;
  const writeBlocked = new Promise<void>((resolve) => { releaseWrite = resolve; });
  const write = gate.enqueue(async () => {
    assert.equal(gate.isCurrent(generation), true);
    actions.push('write-start');
    await writeBlocked;
    actions.push('write-end');
  });
  await Promise.resolve();
  const clear = gate.invalidate(async () => { actions.push('clear'); });
  releaseWrite();
  await Promise.all([write, clear]);
  assert.deepEqual(actions, ['write-start', 'write-end', 'clear']);
});

test('work captured before a clear is stale while new writes follow the clear', async () => {
  const gate = new CacheInvalidationGate();
  const staleGeneration = gate.capture();
  const actions: string[] = [];
  await gate.invalidate(async () => { actions.push('clear'); });
  await gate.enqueue(async () => {
    if (gate.isCurrent(staleGeneration)) actions.push('stale-write');
  });
  const currentGeneration = gate.capture();
  await gate.enqueue(async () => {
    if (gate.isCurrent(currentGeneration)) actions.push('new-write');
  });
  assert.deepEqual(actions, ['clear', 'new-write']);
});

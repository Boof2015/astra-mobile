import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

// Execute the actual loader against an in-memory RNTP and a suspended JS timer
// scheduler. Native Promise completions still run, just as on a locked phone.
function harness(nativeYield: () => Promise<void> = async () => {}) {
  let queue: Record<string, unknown>[] = [];
  let timerCalls = 0;
  const player = {
    setQueue: async (tracks: Record<string, unknown>[]) => { queue = [...tracks]; },
    add: async (tracks: Record<string, unknown>[]) => { queue.push(...tracks); },
    skip: async () => {},
  };
  const source = ts.transpileModule(readFileSync(new URL('./queueLoader.ts', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText;
  const exports: any = {};
  const imports = (name: string) => {
    if (name === 'react-native') return { Platform: { OS: 'android' } };
    if (name === 'react-native-track-player') return { __esModule: true, default: player };
    if (name.includes('astra-library-scanner')) return { AstraLibraryData: { yieldPlaybackQueue: nativeYield } };
    if (name === './recentPlayTracking') return { markManualRecentPlayTransition: () => null, cancelManualRecentPlayTransition: () => {} };
    throw new Error(`Unexpected dependency ${name}`);
  };
  new Function('require', 'exports', 'setTimeout', source)(imports, exports, () => { timerCalls++; });
  return { loader: exports, queue: () => queue, timers: () => timerCalls };
}
const tracks = (count: number, prefix = 'entry') => Array.from({ length: count }, (_, index) => ({ id: index % 2 ? 'b' : 'a', astraCarQueueEntryId: `${prefix}-${index}` }));

test('the complete rolling window fills while JavaScript timers are suspended', async () => {
  let yields = 0;
  const h = harness(async () => { yields++; });
  const expected = tracks(41);
  await h.loader.loadQueueChunked(expected, 0);
  await h.loader.queueLoadSettled();
  assert.deepEqual(h.queue(), expected);
  assert.equal(yields, 4);
  assert.equal(h.timers(), 0);
});

test('a replacement waits for an in-flight yield and prevents stale tail writes', async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const h = harness(() => gate);
  await h.loader.loadQueueChunked(tracks(41), 0);
  assert.equal(h.queue().length, 9);
  const replacement = tracks(3, 'new');
  const replacing = h.loader.loadQueueChunked(replacement, 1);
  release();
  await replacing;
  await h.loader.queueLoadSettled();
  assert.deepEqual(h.queue(), replacement);
  assert.equal(h.timers(), 0);
});

test('appended chunks preserve duplicate occurrence order without JS timers', async () => {
  const h = harness();
  const original = tracks(3);
  const appended = tracks(19, 'append');
  await h.loader.loadQueueChunked(original, 0);
  await h.loader.queueLoadSettled();
  await h.loader.appendUpcomingChunked(appended, original.length);
  await h.loader.queueLoadSettled();
  assert.deepEqual(h.queue(), [...original, ...appended]);
  assert.equal(h.timers(), 0);
});

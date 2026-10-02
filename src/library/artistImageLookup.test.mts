import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import ts from 'typescript';
import * as policy from './artistImagePolicy.ts';

const require = createRequire(import.meta.url);
const { createStore } = require('zustand/vanilla');
const compiled = ts.transpileModule(readFileSync(new URL('./artistImageLookup.ts', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
}).outputText;
const candidate = {
  provider: 'deezer' as const, id: '42', name: 'Artist', imageUrl: 'https://example.test/artist.jpg',
  linkUrl: null, fanCount: 100, albumCount: 10,
};
const success = { status: 'success', candidates: [candidate] };
const target = { artistKey: 'artist', artistName: 'Artist', groupingMode: 'astra', retryCount: 0 };

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

async function settle() {
  for (let i = 0; i < 80; i++) await Promise.resolve();
}

// Execute the real coordinator with controlled I/O and timers. Deferred I/O lets
// each test clear at the exact boundary where a stale result could be committed.
function harness() {
  const timers = new Map<number, { callback: () => void; ms: number }>();
  let timerId = 0;
  const calls: string[] = [];
  const records: any[] = [];
  const hooks = {
    search: async (_signal?: AbortSignal): Promise<any> => success,
    download: async (): Promise<string> => 'deezer.jpg',
    local: async (): Promise<string> => 'custom.webp',
    persist: async (): Promise<void> => {},
    clear: async (): Promise<void> => {},
  };
  const settings = createStore(() => ({
    loaded: true, artistImageAutoPolicy: 'wifi', artistImageDisclosureSeen: true, artistGroupingMode: 'astra',
  }));
  const images = createStore((set: any) => ({
    clearingSource: null, running: false, processed: 0, total: 0, missing: 0,
    beginSweep: (total: number) => set({ running: true, processed: 0, total }),
    advanceSweep: () => set((s: any) => ({ processed: s.processed + 1 })),
    endSweep: () => set({ running: false, processed: 0, total: 0 }),
    refreshMissing: async () => { calls.push('refresh'); },
  }));
  const native = {
    addListener: () => ({ remove: () => {} }),
    getPendingArtistImageLookups: async () => records.length ? [] : [target],
    getArtistImageStats: async () => ({ pending: 30, missing: 1 }),
    clearArtistImageLookupFailures: async () => { calls.push('retry'); return 1; },
    recordArtistImageLookup: async (_key: string, _name: string, _mode: string, values: any) => {
      calls.push('persist:start');
      await hooks.persist();
      records.push(values);
      calls.push('persist:end');
    },
    setManualArtistImage: async () => { calls.push('manual'); },
    clearManualArtistImage: async () => { calls.push('reset'); },
    clearArtistImages: async (source: string) => {
      calls.push(`clear:${source}:start`);
      await hooks.clear();
      if (source === 'deezer') records.length = 0;
      calls.push(`clear:${source}:end`);
    },
  };
  const imports: Record<string, unknown> = {
    'expo-network': {
      getNetworkStateAsync: async () => ({ type: 'WIFI', isConnected: true, isInternetReachable: true }),
      addNetworkStateListener: () => ({ remove: () => {} }),
    },
    '../../modules/astra-library-scanner': {
      AstraLibraryData: native,
      AstraLibraryScanner: { backgroundDelay: async () => {}, cacheArtworkFromUri: () => hooks.local() },
    },
    '@/stores/settingsStore': { useSettingsStore: settings },
    '@/stores/artistImageStore': { useArtistImageStore: images },
    '@/library/scanService': {
      endServiceFor: () => { calls.push('service:end'); },
      reportServiceProgress: () => { calls.push('service:progress'); },
    },
    './artistImagePolicy': policy,
    '@/services/artistImages/deezer': {
      DEEZER_ARTIST_IMAGES_ENABLED: true,
      pickAutomaticDeezerCandidate: (_name: string, candidates: any[]) => candidates[0] ?? null,
      searchDeezerArtists: (_name: string, signal?: AbortSignal) => {
        calls.push('search');
        return hooks.search(signal);
      },
    },
    '@/services/artistImages/cache': { cacheRemoteArtistImage: () => { calls.push('download'); return hooks.download(); } },
  };
  const exports: Record<string, any> = {};
  new Function('require', 'exports', 'setTimeout', 'clearTimeout', compiled)(
    (name: string) => {
      assert.ok(name in imports, `Unexpected import: ${name}`);
      return imports[name];
    },
    exports,
    (callback: () => void, ms: number) => { const id = ++timerId; timers.set(id, { callback, ms }); return id; },
    (id: number) => timers.delete(id),
  );
  const api = exports as typeof import('./artistImageLookup.ts');
  async function runScheduled() {
    const entry = [...timers].find(([, timer]) => timer.ms === 750);
    assert.ok(entry, 'A sweep must be scheduled');
    timers.delete(entry[0]);
    entry[1].callback();
    await settle();
  }
  async function start() { api.startArtistImageLookupCoordinator(); await runScheduled(); }
  return { api, hooks, calls, records, settings, images, timers, runScheduled, start };
}

test('clear during search aborts the request and discards a late provider result', async () => {
  const h = harness();
  const search = deferred<any>();
  let signal: AbortSignal | undefined;
  h.hooks.search = async (value) => { signal = value; return search.promise; };
  await h.start();
  assert.equal(h.images.getState().running, true);
  await h.api.clearArtistImages('deezer');
  assert.equal(signal?.aborted, true);
  assert.equal(h.settings.getState().artistImageAutoPolicy, 'off');
  assert.equal(h.images.getState().running, false);
  assert.ok(h.calls.includes('service:end'));
  search.resolve(success);
  await settle();
  assert.equal(h.records.length, 0);
  assert.equal(h.calls.includes('download'), false);
  assert.equal(h.timers.size, 0);
});

for (const outcome of ['success', 'failure'] as const) {
  test(`clear during image download ignores late ${outcome} without retrying`, async () => {
    const h = harness();
    const download = deferred<string>();
    h.hooks.download = () => download.promise;
    await h.start();
    assert.ok(h.calls.includes('download'));
    await h.api.clearArtistImages('deezer');
    if (outcome === 'success') download.resolve('late.jpg');
    else download.reject(new Error('Download failed'));
    await settle();
    assert.equal(h.records.length, 0);
    assert.equal(h.timers.size, 0);
  });
}

test('clear waits for an existing native write, then removes its result', async () => {
  const h = harness();
  const persist = deferred<void>();
  h.hooks.persist = () => persist.promise;
  await h.start();
  assert.ok(h.calls.includes('persist:start'));
  const clear = h.api.clearArtistImages('deezer');
  await settle();
  assert.equal(h.calls.includes('clear:deezer:start'), false);
  persist.resolve();
  await clear;
  assert.ok(h.calls.indexOf('persist:end') < h.calls.indexOf('clear:deezer:start'));
  assert.equal(h.records.length, 0);
  assert.equal(h.timers.size, 0);
});

test('custom clearing preserves the current automatic sweep and policy', async () => {
  const h = harness();
  const download = deferred<string>();
  h.hooks.download = () => download.promise;
  await h.start();
  await h.api.clearArtistImages('manual');
  assert.equal(h.settings.getState().artistImageAutoPolicy, 'wifi');
  assert.equal(h.images.getState().running, true);
  download.resolve('deezer.jpg');
  await settle();
  assert.equal(h.records[0].automaticImageHash, 'deezer.jpg');
});

test('custom clear invalidates a pending local selection, without invalidating Deezer selection', async () => {
  const h = harness();
  const local = deferred<string>();
  const download = deferred<string>();
  h.hooks.local = () => local.promise;
  h.hooks.download = () => download.promise;
  const pickLocal = h.api.selectLocalArtistImage('artist', 'Artist', 'astra', 'file://picture');
  const pickDeezer = h.api.selectDeezerArtistImage('artist', 'Artist', 'astra', candidate);
  await h.api.clearArtistImages('manual');
  local.resolve('late-custom.webp');
  download.resolve('chosen-deezer.jpg');
  await Promise.all([pickLocal, pickDeezer]);
  assert.equal(h.calls.includes('manual'), false);
  assert.equal(h.records[0].automaticImageHash, 'chosen-deezer.jpg');
});

test('Deezer clear invalidates manual Deezer selection but preserves pending local selection', async () => {
  const h = harness();
  const local = deferred<string>();
  const download = deferred<string>();
  h.hooks.local = () => local.promise;
  h.hooks.download = () => download.promise;
  const pickLocal = h.api.selectLocalArtistImage('artist', 'Artist', 'astra', 'file://picture');
  const pickDeezer = h.api.selectDeezerArtistImage('artist', 'Artist', 'astra', candidate);
  await h.api.clearArtistImages('deezer');
  local.resolve('custom.webp');
  download.resolve('late-deezer.jpg');
  await Promise.all([pickLocal, pickDeezer]);
  assert.equal(h.calls.includes('manual'), true);
  assert.equal(h.records.length, 0);
});

test('failed clear retains policy, unlocks controls, and permits automatic work to restart', async () => {
  const h = harness();
  h.hooks.clear = async () => { throw new Error('Database unavailable'); };
  await assert.rejects(h.api.clearArtistImages('deezer'), /Database unavailable/);
  assert.equal(h.settings.getState().artistImageAutoPolicy, 'wifi');
  assert.equal(h.images.getState().clearingSource, null);
  await h.runScheduled();
  assert.equal(h.records[0].automaticImageHash, 'deezer.jpg');
  h.hooks.clear = async () => {};
  await h.api.clearArtistImages('deezer');
  assert.equal(h.records.length, 0);
});

test('re-enabling automatic downloads starts a new sweep while a stale download finishes', async () => {
  const h = harness();
  const oldDownload = deferred<string>();
  const newDownload = deferred<string>();
  h.hooks.download = () => oldDownload.promise;
  await h.start();
  await h.api.clearArtistImages('deezer');
  h.hooks.download = () => newDownload.promise;
  h.settings.setState({ artistImageAutoPolicy: 'wifi' });
  await h.runScheduled();
  oldDownload.resolve('stale.jpg');
  await settle();
  assert.equal(h.images.getState().running, true);
  assert.equal(h.records.length, 0);
  newDownload.resolve('fresh.jpg');
  await settle();
  assert.equal(h.records[0].automaticImageHash, 'fresh.jpg');
  assert.equal(h.images.getState().running, false);
});

test('clear cancels existing retry timers and rejects overlapping clears', async () => {
  const h = harness();
  h.hooks.search = async () => ({ status: 'transient_error', code: 'provider', retryAfterMs: 5000 });
  await h.start();
  assert.ok([...h.timers.values()].some((timer) => timer.ms === 5000));
  const nativeClear = deferred<void>();
  h.hooks.clear = () => nativeClear.promise;
  const clear = h.api.clearArtistImages('deezer');
  await assert.rejects(h.api.clearArtistImages('manual'), /already being cleared/);
  await assert.rejects(h.api.selectLocalArtistImage('artist', 'Artist', 'astra', 'file://picture'), /being cleared/);
  nativeClear.resolve();
  await clear;
  assert.equal(h.timers.size, 0);
});

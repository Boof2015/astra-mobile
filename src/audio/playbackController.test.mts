import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { create } from 'zustand';
import ts from 'typescript';

const State = { Playing: 'playing', Paused: 'paused', Ready: 'ready', Buffering: 'buffering', Loading: 'loading' };
const RepeatMode = { Off: 0, Track: 1, Queue: 2 };
const compiled = new Map<string, string>();
const tracks = (count: number) => Array.from({ length: count }, (_, index) => ({
  id: `track-${index}`, path: `/music/${index}.flac`, duration: 120,
}));
type TestTrack = ReturnType<typeof tracks>[number];
type NativeTrack = TestTrack & { url: string; astraQueuePosition?: number };

// Run the real controller, queue loader, and stores against in-memory native
// boundaries. Each harness gets fresh module state, including virtualContext.
async function harness(options: {
  count?: number;
  order?: TestTrack[];
  activePosition?: number;
  windowEnd?: number;
  virtual?: boolean;
  repeat?: 'none' | 'all' | 'one';
  paused?: boolean;
  shuffle?: boolean;
  staleMirrorIndex?: number;
} = {}) {
  const order = options.order ?? tracks(options.count ?? 3);
  let activePosition = options.activePosition ?? order.length - 1;
  let nativeQueue: NativeTrack[] = [];
  let nativeIndex: number | undefined;
  let nativeState = State.Playing;
  let nativeRepeat = RepeatMode.Off;
  let position = 0;
  const calls = { next: 0, play: 0, positions: [] as number[], prepared: [] as (string | undefined)[], primed: [] as (string | undefined)[] };
  const player = {
    getQueue: async () => [...nativeQueue],
    getActiveTrackIndex: async () => nativeIndex,
    getActiveTrack: async () => nativeIndex == null ? undefined : nativeQueue[nativeIndex],
    getPlaybackState: async () => ({ state: nativeState }),
    getProgress: async () => ({ position, duration: 120 }),
    setRepeatMode: async (mode: number) => { nativeRepeat = mode; },
    setQueue: async (queue: NativeTrack[]) => {
      nativeQueue = [...queue];
      nativeIndex = queue.length ? 0 : undefined;
      position = 0;
    },
    add: async (queue: NativeTrack[]) => { nativeQueue.push(...queue); },
    skip: async (index: number) => { nativeIndex = index; position = 0; },
    skipToNext: async () => {
      calls.next++;
      if (nativeIndex == null) return;
      if (nativeIndex + 1 < nativeQueue.length) {
        nativeIndex++;
        position = 0;
      } else if (nativeRepeat === RepeatMode.Queue) {
        nativeIndex = 0;
        position = 0;
      }
    },
    seekTo: async (seconds: number) => { position = seconds; },
    play: async () => { calls.play++; nativeState = State.Playing; },
  };
  const window = (start: number, end: number) => ({
    sessionId: 'session', sessionEpoch: 1, queueRevision: 1,
    windowStart: start, activePosition, totalCount: order.length,
    items: order.slice(start, end).map((track, index) => ({
      ...track, queuePosition: start + index, queueEntryId: start + index + 1,
    })),
  });
  const library = {
    createPlaybackContext: async () => {
      const start = Math.max(0, activePosition - 8);
      return window(start, options.windowEnd ?? start + 41);
    },
    updatePlaybackPosition: async (_session: string, next: number) => {
      calls.positions.push(next);
      activePosition = next;
    },
    getPlaybackWindow: async (_session: string, start: number, limit: number) => window(start, start + limit),
    yieldPlaybackQueue: async () => {},
  };
  const modules: Record<string, string> = {
    './playbackController': './playbackController.ts',
    './queueLoader': './queueLoader.ts',
    '@/audio/queueLoader': './queueLoader.ts',
    './playbackNavigation': './playbackNavigation.ts',
    './virtualPlaybackWindow': './virtualPlaybackWindow.ts',
    './recentPlayTracking': './recentPlayTracking.ts',
    '@/stores/playerStore': '../stores/playerStore.ts',
    '@/stores/queueStore': '../stores/queueStore.ts',
    '@/session/playbackMaterialization': '../session/playbackMaterialization.ts',
  };
  const mocks: Record<string, unknown> = {
    'zustand': { create },
    'react-native': { Platform: { OS: 'android' } },
    'react-native-track-player': { __esModule: true, default: player, State, RepeatMode },
    '../../modules/astra-library-scanner': { AstraLibraryData: library },
    '../../modules/astra-car': { AstraCar: {} },
    './carSync': { initializeCarContextSync: () => {} },
    './trackPlayer': { setupPlayer: async () => {} },
    '@/stores/playbackTargetStore': { usePlaybackTargetStore: { getState: () => ({ setTarget: async () => {} }) } },
    '@/stores/nowPlayingTrackTransitionStore': { markNowPlayingTrackTransitionDirection: () => {} },
    '@/library/trackAdapter': { dbTrackToTrack: (track: TestTrack) => ({ ...track }) },
    './sampleTracks': {
      toRntpTrack: (track: TestTrack) => ({ ...track, url: track.path, astraPath: track.path }),
      rntpToTrack: (track: NativeTrack) => ({ ...track }),
    },
    './audioProcessingStartup': {
      dspTargetFromTrack: (track?: TestTrack) => track?.id,
      prepareAudioProcessingForPlayback: async (id?: string) => { calls.prepared.push(id); },
      primePreparedTrackForPlayback: async (id?: string) => { calls.primed.push(id); },
    },
  };
  const cache = new Map<string, any>();
  function load(name: string): any {
    if (Object.hasOwn(mocks, name)) return mocks[name];
    const file = modules[name];
    if (!file) throw new Error(`Unexpected dependency ${name}`);
    if (!cache.has(file)) {
      if (!compiled.has(file)) {
        compiled.set(file, ts.transpileModule(readFileSync(new URL(file, import.meta.url), 'utf8'), {
          compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
        }).outputText);
      }
      const exports = {};
      cache.set(file, exports);
      new Function('require', 'exports', compiled.get(file)!)(load, exports);
    }
    return cache.get(file);
  }
  const controller = load('./playbackController');
  const playerStore = load('@/stores/playerStore').usePlayerStore;
  const queueStore = load('@/stores/queueStore').useQueueStore;
  const loader = load('./queueLoader');
  playerStore.setState({ repeat: options.repeat ?? 'all', shuffle: options.shuffle ?? false });
  const source = { kind: 'playlist', label: 'Test queue' };
  if (options.virtual === false) {
    await controller.playTracks(order, { startIndex: activePosition, source });
  } else {
    await controller.playLibraryQuery({}, { source, shuffle: options.shuffle ?? false });
  }
  await loader.queueLoadSettled();
  nativeState = options.paused ? State.Paused : State.Playing;
  position = 37;
  playerStore.setState({ playbackState: nativeState, currentTime: position });
  if (options.staleMirrorIndex != null) queueStore.getState().setActiveIndex(options.staleMirrorIndex);
  calls.play = 0;
  calls.prepared.length = 0;
  calls.primed.length = 0;
  return {
    controller, calls, playerStore, queueStore, order,
    native: () => ({ queue: nativeQueue, index: nativeIndex, state: nativeState, repeat: nativeRepeat, position }),
    next: async () => { await controller.skipToNext(); await loader.queueLoadSettled(); },
  };
}

for (const paused of [false, true]) {
  for (const count of [1, 3, 100]) {
    test(`Next wraps a ${count}-track virtual queue while ${paused ? 'paused' : 'playing'}`, async () => {
      const h = await harness({ count, paused });
      await h.next();
      assert.deepEqual(h.calls.positions, [0]);
      assert.equal(h.calls.next, 0);
      assert.equal(h.calls.play, 1);
      assert.deepEqual(h.calls.prepared, [h.order[0].id]);
      assert.deepEqual(h.calls.primed, [h.order[0].id]);
      assert.equal(h.native().index, 0);
      assert.equal(h.native().position, 0);
      assert.equal(h.native().state, State.Playing);
      assert.equal(h.native().repeat, RepeatMode.Off);
      assert.ok(h.native().queue.length <= 41);
      assert.equal(h.playerStore.getState().currentTrack.id, h.order[0].id);
      assert.equal(h.playerStore.getState().currentTime, 0);
      assert.equal(h.playerStore.getState().playbackState, 'playing');
      assert.equal(h.queueStore.getState().activeIndex, 0);
      assert.equal(h.queueStore.getState().transport.windowStart, 0);
      assert.deepEqual(h.queueStore.getState().source, { kind: 'playlist', label: 'Test queue' });
    });
  }
}

test('wraps to the first occurrence in the existing shuffled order', async () => {
  const original = tracks(4);
  const order = [original[2], original[0], original[3], original[0], original[1]];
  const h = await harness({ order, shuffle: true });
  await h.next();
  assert.deepEqual(h.native().queue.map((track) => track.id), order.map((track) => track.id));
  assert.equal(h.playerStore.getState().currentTrack.id, order[0].id);
  assert.equal(h.playerStore.getState().shuffle, true);
  assert.equal(h.playerStore.getState().repeat, 'all');
});

test('uses the native final index when the UI mirror lags behind', async () => {
  const h = await harness({ count: 100, staleMirrorIndex: 0 });
  await h.next();
  assert.deepEqual(h.calls.positions, [0]);
  assert.equal(h.playerStore.getState().currentTrack.id, h.order[0].id);
});

test('advances past an exhausted transport window using the native logical position', async () => {
  const h = await harness({ count: 100, activePosition: 40, windowEnd: 41, staleMirrorIndex: 0 });
  await h.next();
  assert.deepEqual(h.calls.positions, [41]);
  assert.equal(h.calls.next, 0);
  assert.equal(h.playerStore.getState().currentTrack.id, h.order[41].id);
  assert.equal(h.controller.getVirtualQueueState().activePosition, 41);
});

test('uses native Next when the next virtual track is already loaded', async () => {
  const h = await harness({ activePosition: 1 });
  await h.next();
  assert.equal(h.calls.next, 1);
  assert.deepEqual(h.calls.positions, []);
  assert.equal(h.native().index, 2);
});

for (const repeat of ['none', 'one'] as const) {
  test(`does not wrap a virtual queue with repeat ${repeat}`, async () => {
    const h = await harness({ repeat });
    await h.next();
    assert.deepEqual(h.calls.positions, []);
    assert.equal(h.calls.next, 1);
    assert.equal(h.calls.play, 0);
    assert.equal(h.native().index, 2);
    assert.equal(h.native().position, 37);
    assert.equal(h.native().repeat, repeat === 'one' ? RepeatMode.Track : RepeatMode.Off);
  });
}

for (const repeat of ['none', 'all', 'one'] as const) {
  test(`ordinary queues continue to delegate Next with repeat ${repeat}`, async () => {
    const h = await harness({ virtual: false, repeat });
    await h.next();
    assert.equal(h.calls.next, 1);
    assert.deepEqual(h.calls.positions, []);
    assert.equal(h.native().index, repeat === 'all' ? 0 : 2);
    assert.equal(h.controller.getVirtualQueueState(), null);
  });
}

test('natural completion still wraps a virtual queue with repeat-all', async () => {
  const h = await harness({ count: 100 });
  assert.equal(await h.controller.handleVirtualQueueEnded(), true);
  assert.deepEqual(h.calls.positions, [0]);
  assert.equal(h.native().index, 0);
  assert.equal(h.native().position, 0);
  assert.equal(h.native().state, State.Playing);
  assert.equal(h.playerStore.getState().currentTrack.id, h.order[0].id);
});

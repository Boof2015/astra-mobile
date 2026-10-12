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
type NativeTrack = TestTrack & { url: string; astraQueuePosition?: number; astraQueueEntryId?: number; astraCarQueueEntryId?: string };

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
  empty?: boolean;
} = {}) {
  const order = [...(options.order ?? tracks(options.count ?? 3))];
  const available = new Map(order.map((track) => [track.path, track]));
  const entryIds = order.map((_, index) => index + 1);
  let nextEntryId = order.length + 1;
  let queueRevision = 1;
  let carSequence = 0;
  const failures = { prepare: false, setQueue: false, play: false, create: false, mutate: false };
  let activePosition = options.activePosition ?? order.length - 1;
  let nativeQueue: NativeTrack[] = [];
  let nativeIndex: number | undefined;
  let nativeState = State.Playing;
  let nativeRepeat = RepeatMode.Off;
  let position = 0;
  const calls = { next: 0, play: 0, positions: [] as number[], prepared: [] as (string | undefined)[], primed: [] as (string | undefined)[], mutations: [] as Record<string, any>[] };
  const player = {
    getQueue: async () => [...nativeQueue],
    getActiveTrackIndex: async () => nativeIndex,
    getActiveTrack: async () => nativeIndex == null ? undefined : nativeQueue[nativeIndex],
    getPlaybackState: async () => ({ state: nativeState }),
    getProgress: async () => ({ position, duration: 120 }),
    setRepeatMode: async (mode: number) => { nativeRepeat = mode; },
    setQueue: async (queue: NativeTrack[]) => {
      if (failures.setQueue) { failures.setQueue = false; throw new Error('setQueue failed'); }
      nativeQueue = [...queue];
      nativeIndex = queue.length ? 0 : undefined;
      position = 0;
    },
    add: async (queue: NativeTrack[] | NativeTrack, index = nativeQueue.length) => {
      const additions = Array.isArray(queue) ? queue : [queue];
      nativeQueue.splice(index, 0, ...additions);
      if (nativeIndex != null && index <= nativeIndex) nativeIndex += additions.length;
    },
    removeUpcomingTracks: async () => { nativeQueue.splice((nativeIndex ?? -1) + 1); },
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
    play: async () => {
      if (failures.play) { failures.play = false; throw new Error('play failed'); }
      calls.play++; nativeState = State.Playing;
    },
  };
  const window = (start: number, end: number) => ({
    sessionId: 'session', sessionEpoch: 1, queueRevision,
    windowStart: start, activePosition, totalCount: order.length,
    items: order.slice(start, end).map((track, index) => ({
      ...track, queuePosition: start + index, queueEntryId: entryIds[start + index],
    })),
  });
  const library = {
    getTrack: async (path: string) => available.get(path) ?? null,
    createPlaybackContext: async () => {
      if (failures.create) throw new Error('This collection has no available tracks.');
      const start = Math.max(0, activePosition - 8);
      return window(start, options.windowEnd ?? start + 41);
    },
    mutatePlaybackContext: async (operation: string, values: Record<string, any>) => {
      assert.equal(operation, 'insertAndPlay');
      calls.mutations.push(values);
      if (failures.mutate) throw new Error('The queue changed. Try that song again.');
      assert.equal(values.sessionId, 'session');
      assert.equal(values.sessionEpoch, 1);
      const anchor = entryIds.indexOf(values.anchorEntryId);
      assert.ok(anchor >= 0);
      const selected = available.get(values.path);
      if (!selected) throw new Error('This song is no longer available.');
      activePosition = anchor;
      if (order[anchor].path !== selected.path) {
        activePosition++;
        order.splice(activePosition, 0, selected);
        entryIds.splice(activePosition, 0, nextEntryId++);
        queueRevision++;
      }
      const start = Math.max(0, activePosition - 8);
      return window(start, start + 41);
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
      toRntpTrack: (track: TestTrack) => ({ ...track, url: track.path, astraPath: track.path, astraCarQueueEntryId: `entry-${++carSequence}` }),
      rntpToTrack: (track: NativeTrack) => ({ ...track }),
    },
    './audioProcessingStartup': {
      dspTargetFromTrack: (track?: TestTrack) => track?.id,
      prepareAudioProcessingForPlayback: async (id?: string) => {
        if (failures.prepare) { failures.prepare = false; throw new Error('prepare failed'); }
        calls.prepared.push(id);
      },
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
  if (options.empty) {
    queueStore.getState().setSnapshot([], -1, { source: null, transport: null });
  } else if (options.virtual === false) {
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
    controller, calls, playerStore, queueStore, order, available, failures,
    advanceNative: (index: number) => { nativeIndex = index; },
    restore: () => {
      const snapshot = controller.getPlaybackSessionSnapshot();
      if (options.virtual === false) {
        controller.restorePlaybackSession({ ...snapshot, tracks: queueStore.getState().tracks });
      } else {
        const start = Math.max(0, activePosition - 8);
        controller.restoreVirtualPlaybackContext(window(start, start + 41), snapshot);
      }
      nativeQueue = [];
      nativeIndex = undefined;
    },
    playNow: async (selected: TestTrack) => {
      available.set(selected.path, selected);
      await controller.playTrackNow(selected, { kind: 'search', label: 'Search: test' });
      await loader.queueLoadSettled();
    },
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

const searchSong = { id: 'search-song', path: '/music/substring-match.flac', duration: 180 };

for (const virtual of [false, true]) {
  for (const paused of [false, true]) {
    test(`search inserts and plays without losing the ${virtual ? 'virtual' : 'ordinary'} queue (${paused ? 'paused' : 'playing'})`, async () => {
      const h = await harness({ virtual, paused, activePosition: 0 });
      const before = h.native().queue.map((track) => track.path);
      await h.playNow(searchSong);
      assert.deepEqual(h.native().queue.map((track) => track.path), [before[0], searchSong.path, ...before.slice(1)]);
      assert.equal(h.native().index, 1);
      assert.equal(h.native().position, 0);
      assert.equal(h.native().state, State.Playing);
      assert.equal(h.playerStore.getState().currentTrack.path, searchSong.path);
      assert.equal(h.queueStore.getState().activeIndex, 1);
      assert.equal(h.queueStore.getState().source.kind, 'playlist');
      assert.equal(h.playerStore.getState().repeat, 'all');
      if (virtual) assert.equal(h.controller.getVirtualQueueState().totalCount, 4);
    });
  }

  test(`search keeps later duplicates in a ${virtual ? 'virtual' : 'ordinary'} queue`, async () => {
    const order = [tracks(1)[0], tracks(2)[1], searchSong];
    const h = await harness({ virtual, order, activePosition: 0, shuffle: true, repeat: 'one' });
    const before = h.native().queue.map((track) => track.path);
    await h.playNow(searchSong);
    assert.deepEqual(h.native().queue.map((track) => track.path), [before[0], searchSong.path, ...before.slice(1)]);
    const copies = h.native().queue.filter((track) => track.path === searchSong.path);
    assert.notEqual(copies[0].astraCarQueueEntryId, copies[1].astraCarQueueEntryId);
    if (virtual) assert.notEqual(copies[0].astraQueueEntryId, copies[1].astraQueueEntryId);
    assert.equal(h.playerStore.getState().shuffle, true);
    assert.equal(h.playerStore.getState().repeat, 'one');
    if (!virtual) {
      await h.controller.setShuffleEnabled(false);
      assert.deepEqual(h.native().queue.map((track) => track.path), [order[0].path, searchSong.path, order[1].path, searchSong.path]);
      assert.notEqual(h.native().queue[1].astraCarQueueEntryId, h.native().queue[3].astraCarQueueEntryId);
    }
  });

  test(`search restarts the current ${virtual ? 'virtual' : 'ordinary'} occurrence without duplicating it`, async () => {
    const h = await harness({ virtual, activePosition: 1, paused: true });
    await h.playNow(h.order[1]);
    assert.equal(h.native().queue.length, 3);
    assert.equal(h.native().index, 1);
    assert.equal(h.native().position, 0);
    assert.equal(h.native().state, State.Playing);
  });

  test(`search uses the native active occurrence in a ${virtual ? 'virtual' : 'ordinary'} queue`, async () => {
    const h = await harness({ virtual, activePosition: 0 });
    h.advanceNative(1);
    const before = h.native().queue.map((track) => track.path);
    await h.playNow(searchSong);
    assert.deepEqual(h.native().queue.map((track) => track.path), [...before.slice(0, 2), searchSong.path, before[2]]);
    assert.equal(h.native().index, 2);
    if (virtual) assert.equal(h.calls.mutations[0].anchorEntryId, 2);
  });

  test(`search preserves and materializes a restored ${virtual ? 'virtual' : 'ordinary'} queue`, async () => {
    const h = await harness({ virtual, activePosition: 0 });
    h.restore();
    await h.playNow(searchSong);
    assert.equal(h.native().queue.length, 4);
    assert.equal(h.native().queue[1].path, searchSong.path);
    assert.equal(h.native().index, 1);
    assert.equal(h.playerStore.getState().restoredSessionPending, false);
  });

  test(`unavailable selection preserves a restored ${virtual ? 'virtual' : 'ordinary'} queue`, async () => {
    const h = await harness({ virtual, activePosition: 0 });
    h.restore();
    const snapshot = h.controller.getPlaybackSessionSnapshot();
    await assert.rejects(h.controller.playTrackNow(searchSong, { kind: 'search', label: 'Search' }), /no longer available/);
    assert.deepEqual(h.controller.getPlaybackSessionSnapshot(), snapshot);
    assert.equal(h.playerStore.getState().restoredSessionPending, true);
    assert.equal(h.native().queue.length, 0);
  });

  test(`consecutive selections are serialized in a ${virtual ? 'virtual' : 'ordinary'} queue`, async () => {
    const h = await harness({ virtual, activePosition: 0 });
    const another = { ...searchSong, id: 'another', path: '/music/another.flac' };
    const before = h.native().queue.map((track) => track.path);
    await Promise.all([h.playNow(searchSong), h.playNow(another)]);
    assert.deepEqual(h.native().queue.map((track) => track.path), [before[0], searchSong.path, another.path, ...before.slice(1)]);
    assert.equal(h.native().index, 2);
  });
}

test('search starts a singleton queue when no queue exists', async () => {
  const h = await harness({ empty: true, shuffle: true, repeat: 'one' });
  await h.playNow(searchSong);
  assert.deepEqual(h.native().queue.map((track) => track.path), [searchSong.path]);
  assert.equal(h.native().state, State.Playing);
  assert.equal(h.queueStore.getState().source.kind, 'search');
  assert.equal(h.playerStore.getState().shuffle, true);
  assert.equal(h.playerStore.getState().repeat, 'one');
});

test('ordinary search failure reconciles the active index and keeps upcoming tracks', async () => {
  const h = await harness({ virtual: false, activePosition: 0 });
  h.failures.prepare = true;
  await assert.rejects(h.playNow(searchSong), /prepare failed/);
  assert.equal(h.native().queue.length, 4);
  assert.equal(h.queueStore.getState().activeIndex, h.native().index);
  assert.equal(h.playerStore.getState().currentTrack.path, h.native().queue[0].path);
});

test('ordinary duplicate occurrences survive save, restore, and disabling shuffle', async () => {
  const order = [tracks(1)[0], tracks(2)[1], searchSong];
  const h = await harness({ virtual: false, order, activePosition: 0, shuffle: true });
  await h.playNow(searchSong);
  h.restore();
  await h.controller.setShuffleEnabled(false);
  assert.deepEqual(h.native().queue.map((track) => track.path), [order[0].path, searchSong.path, order[1].path, searchSong.path]);
  assert.notEqual(h.native().queue[1].astraCarQueueEntryId, h.native().queue[3].astraCarQueueEntryId);
});

test('search preserves the full logical queue outside the transport window', async () => {
  const h = await harness({ count: 120, activePosition: 70 });
  const before = h.order.map((track) => track.path);
  await h.playNow(searchSong);
  assert.deepEqual(h.order.map((track) => track.path), [...before.slice(0, 71), searchSong.path, ...before.slice(71)]);
  assert.equal(h.controller.getVirtualQueueState().activePosition, 71);
  assert.equal(h.controller.getVirtualQueueState().totalCount, 121);
  assert.ok(h.native().queue.length <= 41);
});

for (const failure of ['prepare', 'setQueue', 'play'] as const) {
  test(`virtual search ${failure} failure preserves the complete queue and reconciles playback`, async () => {
    const h = await harness({ count: 120, activePosition: 70 });
    const before = h.order.map((track) => track.path);
    h.failures[failure] = true;
    await assert.rejects(h.playNow(searchSong), /failed/);
    assert.deepEqual(h.order.filter((track) => track.path !== searchSong.path).map((track) => track.path), before);
    assert.equal(h.controller.getVirtualQueueState().totalCount, 121);
    assert.equal(h.playerStore.getState().currentTrack.path, h.native().queue[h.native().index!].path);
    assert.equal(h.queueStore.getState().source.kind, 'playlist');
  });
}

test('rejected replacement retains pending restored playback', async () => {
  const h = await harness({ activePosition: 0 });
  h.restore();
  const before = h.controller.getPlaybackSessionSnapshot();
  h.failures.create = true;
  await assert.rejects(h.controller.playLibraryQuery({ kind: 'search', query: 'no matches' }, { source: { kind: 'search', label: 'Search' } }), /no available tracks/);
  assert.equal(h.playerStore.getState().restoredSessionPending, true);
  assert.deepEqual(h.controller.getPlaybackSessionSnapshot(), before);
});

test('stale native session rejection leaves playback intact and does not block the next selection', async () => {
  const h = await harness({ activePosition: 0 });
  const before = h.native().queue.map((track) => track.path);
  h.failures.mutate = true;
  await assert.rejects(h.playNow(searchSong), /queue changed/);
  assert.deepEqual(h.native().queue.map((track) => track.path), before);
  h.failures.mutate = false;
  await h.playNow(searchSong);
  assert.equal(h.playerStore.getState().currentTrack.path, searchSong.path);
});

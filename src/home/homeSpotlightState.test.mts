import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createHomeSpotlightController, createSpotlightHistory, parseSpotlightHistory, rememberSpotlight,
  type HomeSpotlight,
} from './homeSpotlightState.ts';
import type { HomeSpotlightIdentity, HomeSpotlightRequest } from '../../modules/astra-library-scanner/index.ts';

const album = (key: string): HomeSpotlightIdentity => ({ kind: 'album', key });
const artist = (key: string): HomeSpotlightIdentity => ({ kind: 'artist', key, groupingMode: 'astra' });
const card = (key: string) => ({ kind: 'album', identity: album(key), catalogRevision: '1', album: { identity_key: key } }) as HomeSpotlight;
const preferences = { includeSingles: false, groupingMode: 'astra' as const, includeCollaborations: false };
const tick = () => new Promise<void>((resolve) => setImmediate(resolve));
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

test('history is bounded, distinct, ordered by last display, and namespaced', () => {
  let history: readonly HomeSpotlightIdentity[] = [];
  for (let i = 0; i < 25; i++) history = rememberSpotlight(history, album(String(i)));
  assert.equal(history.length, 20);
  assert.deepEqual(history[0], album('5'));
  history = rememberSpotlight(history, album('5'));
  assert.deepEqual(history.at(-1), album('5'));
  assert.deepEqual(history[0], album('6'));
  assert.equal(rememberSpotlight(history, album('5')), history);
  history = rememberSpotlight(history, artist('5'));
  assert.deepEqual(history.slice(-2), [album('5'), artist('5')]);
  assert.deepEqual(parseSpotlightHistory(JSON.stringify(history)), history);
});

test('missing, malformed, and partial history recovers without losing valid identities', () => {
  for (const raw of [null, '', 'oops', '{}', 'null']) assert.deepEqual(parseSpotlightHistory(raw), []);
  assert.deepEqual(parseSpotlightHistory(JSON.stringify([
    album('ok'), null, {}, { kind: 'album', key: 42 }, { kind: 'album', key: '' },
    { kind: 'artist', key: 'bad-mode', groupingMode: 'invalid' }, artist('ok'), album('ok'),
  ])), [artist('ok'), album('ok')]);
});

test('history hydrates once, serializes saves, and survives restarting its service', async () => {
  let disk = JSON.stringify([album('prior')]);
  const firstWrite = deferred<void>();
  let reads = 0;
  const writes: string[] = [];
  const deps = {
    read: async () => { reads++; return disk; },
    write: async (value: string) => {
      writes.push(value);
      if (writes.length === 1) await firstWrite.promise;
      disk = value;
    },
    warn: (error: unknown) => { throw error; },
  };
  const history = createSpotlightHistory(deps);
  await Promise.all([history.load(), history.load()]);
  assert.equal(reads, 1);
  history.record(album('one'));
  history.record(album('two'));
  history.record(album('two'));
  await tick();
  assert.equal(writes.length, 1);
  firstWrite.resolve();
  await history.flush();
  assert.equal(writes.length, 2);
  const restarted = createSpotlightHistory(deps);
  await restarted.load();
  assert.deepEqual(restarted.recent(), [album('prior'), album('one'), album('two')]);
});

test('storage failures keep session history usable and do not poison later saves', async () => {
  let attempts = 0;
  const errors: unknown[] = [];
  const history = createSpotlightHistory({
    read: async () => { throw new Error('read'); },
    write: async () => { if (++attempts === 1) throw new Error('write'); },
    warn: (error) => { errors.push(error); },
  });
  await history.load();
  history.record(album('one'));
  history.record(album('two'));
  await history.flush();
  assert.equal(errors.length, 2);
  assert.equal(attempts, 2);
  assert.deepEqual(history.recent(), [album('one'), album('two')]);
});

function harness(read: () => Promise<string | null> = async () => null) {
  const calls: { request: HomeSpotlightRequest; result: ReturnType<typeof deferred<HomeSpotlight | null>> }[] = [];
  const errors: unknown[] = [];
  const history = createSpotlightHistory({ read, write: async () => {}, warn: (e) => { errors.push(e); } });
  const controller = createHomeSpotlightController({
    history,
    choose: async (request) => {
      const result = deferred<HomeSpotlight | null>();
      calls.push({ request, result });
      return result.promise;
    },
    warn: (e) => { errors.push(e); },
  });
  return { controller, history, calls, errors };
}

test('first selection waits for preferences, focus, and persisted history; only displayed results count', async () => {
  const disk = deferred<string | null>();
  const h = harness(() => disk.promise);
  h.controller.setActive(true);
  await tick();
  assert.equal(h.calls.length, 0);
  h.controller.configure(preferences);
  await tick();
  assert.equal(h.calls.length, 0);
  disk.resolve(JSON.stringify([artist('prior')]));
  await tick();
  assert.deepEqual(h.calls[0].request.recent, [artist('prior')]);
  h.calls[0].result.resolve(card('next'));
  await tick();
  assert.deepEqual(h.history.recent(), [artist('prior')]);
  h.controller.markShown();
  h.controller.markShown();
  assert.deepEqual(h.history.recent(), [artist('prior'), album('next')]);
  h.controller.setActive(false);
  h.controller.setActive(true);
  h.controller.configure({ ...preferences });
  await tick();
  assert.equal(h.calls.length, 1, 'returning to Home does not query or reroll');
});

test('rapid rerolls issue one request and retain the visible card while loading', async () => {
  const h = harness();
  h.controller.configure(preferences);
  h.controller.setActive(true);
  await tick();
  h.calls[0].result.resolve(card('first'));
  await tick();
  for (let i = 0; i < 20; i++) h.controller.reroll();
  await tick();
  assert.equal(h.calls.length, 2);
  assert.equal(h.controller.getSnapshot().spotlight?.identity.key, 'first');
  assert.equal(h.controller.getSnapshot().busy, true);
  assert.equal(h.calls[1].request.retain, null);
  assert.deepEqual(h.calls[1].request.recent, [album('first')]);
  h.calls[1].result.resolve(card('second'));
  await tick();
  assert.equal(h.controller.getSnapshot().busy, false);
});

test('catalog and preference invalidations coalesce, reject stale results, and retain the current identity', async () => {
  const h = harness();
  h.controller.configure(preferences);
  h.controller.setActive(true);
  await tick();
  h.calls[0].result.resolve(card('visible'));
  await tick();
  h.controller.markShown();
  h.controller.reroll();
  await tick();
  h.controller.configure({ ...preferences, includeSingles: true });
  h.controller.invalidate();
  h.controller.invalidate();
  h.calls[1].result.resolve(card('stale'));
  await tick();
  assert.equal(h.calls.length, 3);
  assert.equal(h.calls[2].request.includeSingles, true);
  assert.deepEqual(h.calls[2].request.retain, album('visible'));
  assert.equal(h.controller.getSnapshot().spotlight?.identity.key, 'visible');
  h.calls[2].result.resolve(card('visible'));
  await tick();
  h.controller.markShown();
  assert.deepEqual(h.history.recent(), [album('visible')]);
});

test('leaving Home drops pending results and defers catalog refreshes until returning', async () => {
  const h = harness();
  h.controller.configure(preferences);
  h.controller.setActive(true);
  await tick();
  h.controller.setActive(false);
  h.controller.invalidate();
  h.calls[0].result.resolve(card('never shown'));
  await tick();
  h.controller.markShown();
  assert.equal(h.controller.getSnapshot().spotlight, null);
  assert.deepEqual(h.history.recent(), []);
  assert.equal(h.calls.length, 1);
  h.controller.setActive(true);
  await tick();
  assert.equal(h.calls.length, 2);
});

test('selection failure retains the card, clears busy, and permits retry without a retry loop', async () => {
  let attempts = 0;
  const history = createSpotlightHistory({ read: async () => null, write: async () => {}, warn: () => {} });
  const controller = createHomeSpotlightController({ history, warn: () => {}, choose: async () => {
    if (++attempts === 2) throw new Error('selection failed');
    return card(String(attempts));
  } });
  controller.configure(preferences);
  controller.setActive(true);
  await tick();
  controller.reroll();
  await tick();
  assert.equal(controller.getSnapshot().spotlight?.identity.key, '1');
  assert.equal(controller.getSnapshot().busy, false);
  assert.equal(attempts, 2);
  controller.reroll();
  await tick();
  assert.equal(controller.getSnapshot().spotlight?.identity.key, '3');
});

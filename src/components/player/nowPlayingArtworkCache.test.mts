import assert from 'node:assert/strict';
import test from 'node:test';
import { NowPlayingArtworkCache, type ArtworkRequest } from './nowPlayingArtworkCache.ts';

const request = (uri: string, pixelSize = 900): ArtworkRequest => ({ uri, pixelSize });
const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

function fixture() {
  const loads: { request: ArtworkRequest; resolve: (image: object) => void; reject: () => void }[] = [];
  const cache = new NowPlayingArtworkCache<object>((request) => new Promise((resolve, reject) => {
    loads.push({ request, resolve, reject: () => reject(new Error('decode failed')) });
  }));
  return { cache, loads };
}

test('deduplicates album covers and in-flight requests by URI and physical size', async () => {
  const { cache, loads } = fixture();
  const a = request('file:///art/a.jpg');
  cache.setRequests([a, { ...a }, request(a.uri, 1200)]);
  await flush();
  assert.equal(loads.length, 2);
  cache.setRequests([]);
  cache.setRequests([a]); // A → B → A while the first decode is still running.
  const image = {};
  loads[0].resolve(image);
  loads[1].resolve({});
  await flush();
  assert.equal(loads.length, 2);
  assert.equal(cache.get(a), image);
  assert.equal(cache.get(request(a.uri, 1200)), null);
});

test('evicts everything outside the visible/neighbor window and ignores late results', async () => {
  const { cache, loads } = fixture();
  const a = request('a'), b = request('b'), c = request('c');
  cache.setRequests([a, b]);
  await flush();
  loads[0].resolve({});
  await flush();
  assert.notEqual(cache.get(a), null);
  cache.setRequests([c]);
  loads[1].resolve({});
  await flush();
  assert.equal(cache.get(a), null);
  assert.equal(cache.get(b), null);
  assert.deepEqual(loads[2].request, c);
});

test('bounds concurrency and gives newly visible artwork the next free slot', async () => {
  const { cache, loads } = fixture();
  cache.setRequests(['a', 'b', 'neighbor'].map((uri) => request(uri)));
  await flush();
  assert.equal(loads.length, 2);
  cache.setRequests(['current', 'a', 'b', 'neighbor'].map((uri) => request(uri)));
  loads[1].resolve({});
  await flush();
  assert.equal(loads.length, 3);
  assert.equal(loads[2].request.uri, 'current');
});

test('background/unmount clear prevents an old decode from repopulating a new session', async () => {
  const { cache, loads } = fixture();
  const a = request('a');
  cache.setRequests([a]);
  await flush();
  cache.clear();
  cache.setRequests([a]);
  loads[0].resolve({ old: true });
  await flush();
  assert.equal(cache.get(a), null);
  assert.equal(loads.length, 2);
  const fresh = { fresh: true };
  loads[1].resolve(fresh);
  await flush();
  assert.equal(cache.get(a), fresh);
  cache.clear();
  assert.equal(cache.get(a), null);
});

test('a failed cover does not spin or block queued neighbors and can be retried after eviction', async () => {
  const { cache, loads } = fixture();
  const a = request('a');
  cache.setRequests([a, request('b'), request('c')]);
  await flush();
  loads[0].reject();
  await flush();
  assert.equal(loads.length, 3);
  cache.setRequests([a]);
  await flush();
  assert.equal(loads.length, 3);
  cache.setRequests([]);
  cache.setRequests([a]);
  loads[1].resolve({});
  await flush();
  assert.equal(loads.length, 4);
  assert.deepEqual(loads[3].request, a);
});

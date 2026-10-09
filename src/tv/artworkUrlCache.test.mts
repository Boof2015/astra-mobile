import test from 'node:test';
import assert from 'node:assert/strict';
import { createTvArtworkResolver } from './artworkUrlCache.ts';
import type { ResolvedRemoteConfig } from '../services/remoteConfig.ts';

function fixture(limit = 512) {
  const config: ResolvedRemoteConfig = { id: 1, type: 'subsonic', baseUrl: 'https://music.invalid', username: 'listener', password: 'test-only' };
  const registry = new Map([[1, config]]);
  let builds = 0;
  const resolve = createTvArtworkResolver(id => registry.get(id), () => `https://music.invalid/cover?signature=${++builds}`, limit);
  const track = { sourceType: 'subsonic' as const, sourceId: 1, artworkSourceId: 'cover:one' };
  return { config, registry, resolve, track, builds: () => builds };
}

test('repeated focus/playback renders reuse one URL across equivalent track objects', () => {
  const f = fixture();
  const uri = f.resolve(f.track);
  for (let i = 0; i < 100; i++) assert.equal(f.resolve({ ...f.track }, {}), uri);
  assert.equal(f.builds(), 1);
});

test('cover, connection and requested size remain separate identities', () => {
  const f = fixture();
  f.registry.set(2, { ...f.config, id: 2 });
  const inputs = [
    [f.track, {}],
    [{ ...f.track, artworkSourceId: 'cover:two' }, {}],
    [{ ...f.track, sourceId: 2 }, {}],
    [f.track, { size: 256 }],
  ] as const;
  const uris = inputs.map(([track, options]) => f.resolve(track, options));
  assert.equal(new Set(uris).size, 4);
  assert.deepEqual(inputs.map(([track, options]) => f.resolve({ ...track }, options)), uris);
  assert.equal(f.builds(), 4);
});

test('source removal and reconnect never reuse an old authenticated URL', () => {
  const f = fixture();
  const before = f.resolve(f.track);
  f.registry.delete(1);
  assert.equal(f.resolve(f.track), null);
  f.registry.set(1, { ...f.config });
  assert.notEqual(f.resolve(f.track), before);
});

test('changed credentials and in-place Jellyfin token refresh invalidate URLs', () => {
  const f = fixture();
  let previous = f.resolve(f.track);
  for (const update of [
    { password: 'updated-test-only' }, { username: 'other' }, { baseUrl: 'https://other.invalid' },
    { type: 'jellyfin' as const, accessToken: 'test-token', userId: 'user1' },
    { accessToken: 'refreshed-test-token' }, { userId: 'user2' },
  ]) {
    Object.assign(f.config, update);
    const next = f.resolve(f.track);
    assert.notEqual(next, previous);
    assert.equal(f.resolve(f.track), next);
    previous = next;
  }
});

test('local/incomplete sources bypass the cache and unavailable art is retried', () => {
  const f = fixture();
  assert.equal(f.resolve({ ...f.track, sourceType: 'local' }), null);
  assert.equal(f.resolve({ ...f.track, sourceId: undefined }), null);
  assert.equal(f.resolve({ ...f.track, artworkSourceId: undefined }), null);
  assert.equal(f.builds(), 0);
  let ready = false;
  const resolve = createTvArtworkResolver(() => f.config, () => ready ? 'https://music.invalid/ready' : null);
  assert.equal(resolve(f.track), null);
  ready = true;
  assert.equal(resolve(f.track), 'https://music.invalid/ready');
});

test('cache stays bounded and keeps recently focused covers', () => {
  const f = fixture(2);
  const one = f.resolve(f.track);
  const two = { ...f.track, artworkSourceId: 'two' };
  const oldTwo = f.resolve(two);
  assert.equal(f.resolve(f.track), one);
  f.resolve({ ...f.track, artworkSourceId: 'three' });
  assert.equal(f.resolve(f.track), one);
  assert.notEqual(f.resolve(two), oldTwo);
});

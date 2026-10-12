import assert from 'node:assert/strict';
import test from 'node:test';
import { registerHooks } from 'node:module';

// Resolve the app's two pure-TS aliases without loading React Native in Node.
const hook = registerHooks({ resolve(specifier, context, next) {
  return next(specifier.startsWith('@/') ? new URL(`../../${specifier.slice(2)}.ts`, import.meta.url).href : specifier, context);
} });
const { LastFmService } = await import('./scrobbleService.ts');
hook.deregister();
const payload = (value: unknown) => new Response(JSON.stringify(value), { status: 200, headers: { 'Content-Type': 'application/json' } });
function setup(t: Parameters<Parameters<typeof test>[1]>[0]) {
  const opened: string[] = []; const persisted: unknown[] = [];
  const service = new LastFmService({ config: { enabled: false, activeProfileId: 'official-lastfm', profiles: [] }, apiKey: 'fixture-api', sharedSecret: 'fixture-secret', openExternal: async url => { opened.push(url); }, onConfigChange: value => { persisted.push(value); } });
  const original = globalThis.fetch;
  t.after(() => { globalThis.fetch = original; service.stop(); });
  return { service, opened, persisted };
}
test('mobile default still opens the browser; repeated pending auth exposes the same URL', async t => {
  const { service, opened } = setup(t); let calls = 0;
  globalThis.fetch = async () => { calls++; return payload({ token: 'fixture-token' }); };
  const first = await service.beginAuth(); const pending = await service.beginAuth('official-lastfm', { openBrowser: false });
  assert.equal(first.ok, true); assert.equal(opened.length, 1); assert.equal(opened[0], first.authUrl);
  assert.equal(pending.authUrl, first.authUrl); assert.equal(calls, 1);
});
test('TV auth provides a QR URL without opening a browser and persists an approved session', async t => {
  const { service, opened, persisted } = setup(t);
  globalThis.fetch = async (_url, init) => payload(String(init?.body).includes('auth.getToken') ? { token: 'fixture-token' } : { session: { key: 'fixture-session', name: 'fixture-user' } });
  const start = await service.beginAuth('official-lastfm', { openBrowser: false });
  assert.ok(start.authUrl?.includes('token=fixture-token')); assert.equal(opened.length, 0);
  const finish = await service.finishAuth(); assert.equal(finish.connected, true); assert.equal(finish.username, 'fixture-user');
  assert.equal(service.getStatus().authPending, false); assert.equal(persisted.length, 1);
});
test('cancel while token request is pending cannot resurrect sign-in', async t => {
  const { service, opened } = setup(t); let resolve!: (value: Response) => void;
  globalThis.fetch = () => new Promise<Response>(done => { resolve = done; });
  const start = service.beginAuth('official-lastfm', { openBrowser: false }); service.cancelAuth(); resolve(payload({ token: 'late-token' }));
  assert.equal((await start).ok, false); assert.equal(service.getStatus().authPending, false); assert.equal(opened.length, 0);
});
test('cancel while approval is being checked cannot save the late session', async t => {
  const { service, persisted } = setup(t);
  globalThis.fetch = async () => payload({ token: 'fixture-token' });
  await service.beginAuth('official-lastfm', { openBrowser: false });
  let resolve!: (value: Response) => void;
  globalThis.fetch = () => new Promise<Response>(done => { resolve = done; });
  const finish = service.finishAuth(); service.cancelAuth(); resolve(payload({ session: { key: 'late-session', name: 'late-user' } }));
  assert.equal((await finish).ok, false); assert.equal(service.getStatus().connected, false); assert.equal(persisted.length, 0);
});

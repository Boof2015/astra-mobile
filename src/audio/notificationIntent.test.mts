import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { create } from 'zustand';
import ts from 'typescript';
import * as eqShare from './eqShare.ts';
import * as signalShare from './signalShare.ts';
import * as playerPresence from '../stores/playerPresence.ts';

const compiled = new Map<string, string>();
const notificationPaths = [
  'trackplayer://notification.click',
  'astra://notification.click',
  'astra:///notification.click',
  '/notification.click',
  'notification.click',
  '  trackplayer://notification.click?source=widget#player  ',
  '/notification.click?source=notification',
];

// Execute the real intent handlers, overlay store, and fallback route, replacing
// only native/React boundaries so these regressions run in the Node test suite.
function harness(options: {
  nativeTrack?: boolean;
  storedTrack?: boolean;
  nativeFailure?: boolean;
  pendingTrack?: Promise<unknown>;
  canGoBack?: boolean;
} = {}) {
  const navigationCalls: string[] = [];
  let cleanup: (() => void) | undefined;
  const mocks: Record<string, unknown> = {
    zustand: { create },
    react: { useCallback: (callback: unknown) => callback },
    'react/jsx-runtime': { jsx: () => null },
    'react-native': { View: () => null },
    'react-native-track-player': {
      __esModule: true,
      default: {
        getActiveTrack: async () => {
          if (options.nativeFailure) throw new Error('Player is not initialized');
          return options.pendingTrack ?? (options.nativeTrack === false ? undefined : { id: 'track' });
        },
      },
    },
    'expo-router': {
      useRouter: () => ({
        canGoBack: () => options.canGoBack ?? true,
        back: () => navigationCalls.push('back'),
        replace: (href: string) => navigationCalls.push(`replace:${href}`),
      }),
      useFocusEffect: (effect: () => () => void) => { cleanup = effect(); },
    },
    '@/theme/themed': { createThemedStyles: () => () => ({ root: {} }) },
    '@/stores/playerStore': {
      usePlayerStore: { getState: () => ({ currentTrack: options.storedTrack ? { id: 'track' } : null }) },
    },
    '@/stores/playerPresence': playerPresence,
    './eqShare': eqShare,
    './signalShare.ts': signalShare,
  };
  const files: Record<string, string> = {
    '@/audio/notificationIntent': './notificationIntent.ts',
    '@/audio/eqShareIntent': './eqShareIntent.ts',
    '@/audio/signalShareIntent': './signalShareIntent.ts',
    '@/stores/playerUiStore': '../stores/playerUiStore.ts',
    'native-intent': '../app/+native-intent.ts',
    'notification-route': '../app/notification.click.tsx',
  };
  const cache = new Map<string, any>();
  function load(name: string): any {
    if (Object.hasOwn(mocks, name)) return mocks[name];
    const file = files[name];
    if (!file) throw new Error(`Unexpected dependency: ${name}`);
    if (!cache.has(file)) {
      if (!compiled.has(file)) {
        compiled.set(file, ts.transpileModule(readFileSync(new URL(file, import.meta.url), 'utf8'), {
          compilerOptions: {
            module: ts.ModuleKind.CommonJS,
            target: ts.ScriptTarget.ES2022,
            jsx: ts.JsxEmit.ReactJSX,
            esModuleInterop: true,
          },
        }).outputText);
      }
      const exports = {};
      cache.set(file, exports);
      new Function('require', 'exports', compiled.get(file)!)(load, exports);
    }
    return cache.get(file);
  }
  const { redirectSystemPath } = load('native-intent') as typeof import('../app/+native-intent.ts');
  const intent = load('@/audio/notificationIntent') as typeof import('./notificationIntent.ts');
  const { usePlayerUiStore } = load('@/stores/playerUiStore') as typeof import('../stores/playerUiStore.ts');
  return {
    ...intent,
    redirectSystemPath,
    player: usePlayerUiStore,
    navigationCalls,
    enterFallback: () => load('notification-route').default(),
    blurFallback: () => cleanup?.(),
  };
}

const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

test('every notification URL opens the overlay without a navigation destination on resume', async () => {
  for (const path of notificationPaths) {
    const h = harness();
    assert.equal(h.isNotificationClickPath(path), true, path);
    assert.equal(await h.redirectSystemPath({ path, initial: false }), null, path);
    assert.equal(h.player.getState().phase, 'opening');
    assert.equal(h.player.getState().openRequest, 1);
  }
});

test('fresh notification launches open the overlay over Home', async () => {
  for (const path of notificationPaths) {
    const h = harness();
    assert.equal(await h.redirectSystemPath({ path, initial: true }), '/');
    assert.equal(h.player.getState().phase, 'opening');
    assert.ok(h.player.getState().openRequest > 0, 'startup must preserve this open request');
  }
});

test('the overlay action returns no route and repeated taps remain navigation-free', async () => {
  const h = harness();
  assert.equal(await h.openPlayerFromNotification(), undefined);
  h.player.getState().settleOpen();
  for (let index = 0; index < 3; index++) {
    assert.equal(await h.redirectSystemPath({ path: notificationPaths[0], initial: false }), null);
    assert.equal(h.player.getState().phase, 'opening');
    h.player.getState().settleOpen();
  }
  assert.equal(h.player.getState().openRequest, 4);
});

test('missing tracks and failed native lookups never redirect a running app', async () => {
  for (const nativeFailure of [false, true]) {
    for (const storedTrack of [false, true]) {
      const h = harness({ nativeTrack: false, nativeFailure, storedTrack });
      assert.equal(await h.redirectSystemPath({ path: notificationPaths[0], initial: false }), null);
      assert.equal(h.player.getState().phase, storedTrack ? 'opening' : 'closed');
    }
  }
});

test('a fresh launch with no loaded track still reaches Home without opening an empty player', async () => {
  const h = harness({ nativeTrack: false, nativeFailure: true });
  assert.equal(await h.redirectSystemPath({ path: notificationPaths[0], initial: true }), '/');
  assert.equal(h.player.getState().phase, 'closed');
});

test('EQ, Signal, Recently Played, and unrelated links keep their existing destinations', async () => {
  const h = harness();
  const cases = [
    ['astra:eq-preset:v1:AAAA', '/eq/import?data=AAAA'],
    ['astra:signal:v3:AAAA', '/signal/import?data=AAAA'],
    ['astra:///recently-played', 'astra:///recently-played'],
    ['/settings/playback', '/settings/playback'],
    ['/notification.click-extra', '/notification.click-extra'],
  ];
  for (const initial of [false, true]) {
    for (const [path, expected] of cases) {
      assert.equal(h.isNotificationClickPath(path), false);
      assert.equal(await h.redirectSystemPath({ path, initial }), expected);
    }
  }
  assert.equal(h.player.getState().openRequest, 0);
});

test('the fallback route pops exactly one screen, preserving the page beneath it', async () => {
  const h = harness();
  h.enterFallback();
  await flush();
  assert.deepEqual(h.navigationCalls, ['back']);
  assert.equal(h.player.getState().phase, 'opening');
});

test('the fallback replaces itself with Home only when there is no previous screen', async () => {
  const h = harness({ canGoBack: false });
  h.enterFallback();
  await flush();
  assert.deepEqual(h.navigationCalls, ['replace:/']);
});

test('a failed overlay request still dismisses only the fallback route', async () => {
  const h = harness();
  h.player.setState({ openPlayer: () => { throw new Error('Overlay unavailable'); } });
  h.enterFallback();
  await flush();
  assert.deepEqual(h.navigationCalls, ['back']);
});

test('a delayed fallback cannot pop another page after losing focus', async () => {
  let resolveTrack!: (track: unknown) => void;
  const pendingTrack = new Promise((resolve) => { resolveTrack = resolve; });
  const h = harness({ pendingTrack });
  h.enterFallback();
  h.blurFallback();
  resolveTrack({ id: 'track' });
  await flush();
  assert.deepEqual(h.navigationCalls, []);
});

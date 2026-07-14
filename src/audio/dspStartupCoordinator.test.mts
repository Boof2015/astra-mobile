import assert from 'node:assert/strict';
import test from 'node:test';
import { DspStartupCoordinator } from './dspStartupCoordinator.ts';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

test('starts settings, route, and fallback reads concurrently and gates the target', async () => {
  const settings = deferred<string>();
  const route = deferred<string>();
  const fallback = deferred<number>();
  const started: string[] = [];
  const applied: string[] = [];

  const coordinator = new DspStartupCoordinator({
    loadSettings: () => {
      started.push('settings');
      return settings.promise;
    },
    loadEqRoute: () => {
      started.push('route');
      return route.promise;
    },
    loadPersistedFallback: () => {
      started.push('fallback');
      return fallback.promise;
    },
    applyBase: ({ settings: value, route: output, persistedFallback }) => {
      applied.push(`base:${value}:${output}:${persistedFallback}`);
    },
    prepareTarget: (_inputs, target: string) => {
      applied.push(`target:${target}`);
    },
  });

  const preparation = coordinator.prepare('track-1', 'remote-play');
  assert.deepEqual(started, ['settings', 'route', 'fallback']);
  assert.deepEqual(applied, []);

  settings.resolve('enabled');
  route.resolve('usb');
  await Promise.resolve();
  assert.deepEqual(applied, []);

  fallback.resolve(0.5);
  await preparation;
  assert.deepEqual(applied, ['base:enabled:usb:0.5', 'target:track-1']);
});

test('concurrent preparations share cold warm-up but prime each target', async () => {
  let settingsLoads = 0;
  let routeLoads = 0;
  let fallbackLoads = 0;
  const targets: string[] = [];
  const coordinator = new DspStartupCoordinator({
    loadSettings: async () => {
      settingsLoads += 1;
      return 'settings';
    },
    loadEqRoute: async () => {
      routeLoads += 1;
      return 'route';
    },
    loadPersistedFallback: async () => {
      fallbackLoads += 1;
      return 0.5;
    },
    applyBase: () => {},
    prepareTarget: (_inputs, target: string) => {
      targets.push(target);
    },
  });

  await Promise.all([
    coordinator.prepare('one', 'play'),
    coordinator.prepare('two', 'play'),
  ]);

  assert.equal(settingsLoads, 1);
  assert.equal(routeLoads, 1);
  assert.equal(fallbackLoads, 1);
  assert.deepEqual(targets.sort(), ['one', 'two']);
});

test('a failed warm-up is retried by the next explicit preparation', async () => {
  let attempts = 0;
  let primed = false;
  const coordinator = new DspStartupCoordinator({
    loadSettings: async () => {
      attempts += 1;
      if (attempts === 1) throw new Error('db unavailable');
      return 'settings';
    },
    loadEqRoute: async () => 'route',
    loadPersistedFallback: async () => 0.5,
    applyBase: () => {},
    prepareTarget: () => {
      primed = true;
    },
  });

  await assert.rejects(coordinator.prepare('one', 'play'), /db unavailable/);
  assert.equal(primed, false);
  await coordinator.prepare('one', 'play-retry');
  assert.equal(attempts, 2);
  assert.equal(primed, true);
});

test('invalidation makes an existing waiter join the replacement warm-up', async () => {
  const firstSettings = deferred<string>();
  let settingsLoads = 0;
  const applied: string[] = [];
  const coordinator = new DspStartupCoordinator({
    loadSettings: () => {
      settingsLoads += 1;
      return settingsLoads === 1 ? firstSettings.promise : Promise.resolve('new');
    },
    loadEqRoute: async () => 'route',
    loadPersistedFallback: async () => 0.5,
    applyBase: ({ settings }) => {
      applied.push(settings);
    },
    prepareTarget: () => {},
  });

  const waiting = coordinator.prepare('one', 'play');
  const rewarm = coordinator.rewarm('settings-change');
  firstSettings.resolve('old');
  await Promise.all([waiting, rewarm]);

  assert.equal(settingsLoads, 2);
  assert.deepEqual(applied, ['new']);
});

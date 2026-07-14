import assert from 'node:assert/strict';
import test from 'node:test';
import type { AudioOutputRoute, EQBand } from '../types/audio.ts';
import {
  buildAudioOutputRouteKey,
  createEQRouteProfile,
  isAudioOutputRouteUsable,
  normalizeAudioOutputRoute,
  parseEQRouteProfilesJson,
  restoreEQRouteProfile,
  stringifyEQRouteProfiles,
} from './eqRouteProfiles.ts';

let idCounter = 0;
function nextId(): string {
  idCounter += 1;
  return `route-eq-${idCounter}`;
}

function band(overrides: Partial<EQBand> = {}): EQBand {
  return {
    id: overrides.id ?? nextId(),
    type: overrides.type ?? 'peaking',
    frequency: overrides.frequency ?? 1000,
    gain: overrides.gain ?? 0,
    Q: overrides.Q ?? 1,
    enabled: overrides.enabled ?? true,
  };
}

function route(overrides: Partial<AudioOutputRoute> = {}): AudioOutputRoute {
  return {
    key: overrides.key ?? buildAudioOutputRouteKey(overrides.kind ?? 'speaker', overrides.label ?? 'Phone speaker'),
    label: overrides.label ?? 'Phone speaker',
    kind: overrides.kind ?? 'speaker',
    nativeType: overrides.nativeType ?? null,
    nativeId: overrides.nativeId ?? null,
    selectedRouteName: overrides.selectedRouteName ?? null,
    updatedAt: overrides.updatedAt ?? 1,
  };
}

test('normalizes route keys for named and unnamed Bluetooth outputs', () => {
  assert.equal(
    normalizeAudioOutputRoute({ kind: 'bluetooth', label: 'Sony WH-1000XM5' })?.key,
    'bluetooth:name:sony-wh-1000xm5'
  );
  assert.equal(
    normalizeAudioOutputRoute({ kind: 'bluetooth', label: 'Bluetooth audio' })?.key,
    'bluetooth'
  );
});

test('normalizes named external routes and generic class routes', () => {
  assert.equal(normalizeAudioOutputRoute({ kind: 'wired', label: '3.5mm' })?.key, 'wired');
  assert.equal(normalizeAudioOutputRoute({ kind: 'usb', label: 'USB DAC' })?.key, 'usb:name:usb-dac');
  assert.equal(normalizeAudioOutputRoute({ kind: 'usb', label: 'USB audio' })?.key, 'usb');
  assert.equal(normalizeAudioOutputRoute({ kind: 'hdmi', label: 'Living Room TV' })?.key, 'hdmi:name:living-room-tv');
  assert.equal(normalizeAudioOutputRoute({ kind: 'remote', label: 'Remote audio' })?.key, 'remote');
  assert.equal(normalizeAudioOutputRoute({ kind: 'speaker', label: 'Pixel speaker' })?.key, 'speaker');
  assert.equal(normalizeAudioOutputRoute({ kind: 'nonsense', label: '' })?.key, 'unknown');
});

test('accepts concrete unclassified Android outputs without accepting a missing route', () => {
  assert.equal(isAudioOutputRouteUsable(route({ kind: 'unknown', nativeType: 25 })), true);
  assert.equal(isAudioOutputRouteUsable(route({ kind: 'unknown', nativeType: null })), false);
});

test('recovers from corrupt route profile storage', () => {
  assert.deepEqual(parseEQRouteProfilesJson('{not-json', nextId), {});
  assert.deepEqual(
    parseEQRouteProfilesJson(
      JSON.stringify({
        version: 1,
        profiles: {
          speaker: { version: 999, routeKey: 'speaker' },
          wired: { version: 1, routeKey: 'wired', bands: [] },
        },
      }),
      nextId
    ),
    {}
  );
});

test('round-trips full per-route EQ state independently', () => {
  const speaker = route({ key: 'speaker', label: 'Phone speaker', kind: 'speaker' });
  const wired = route({ key: 'wired', label: 'Wired headphones', kind: 'wired' });
  const bluetooth = route({ key: 'bluetooth:sony-wh-1000xm5', label: 'Sony WH-1000XM5', kind: 'bluetooth' });

  const profiles = {
    [speaker.key]: createEQRouteProfile(speaker, {
      enabled: true,
      preamp: -2,
      mode: 'parametric',
      bands: [band({ frequency: 80, gain: 4 })],
      graphicGains: [0, 0, 0, 0, 0],
      activePresetId: 'bass-boost',
    }),
    [wired.key]: createEQRouteProfile(wired, {
      enabled: true,
      preamp: -6,
      mode: 'graphic',
      bands: [band({ frequency: 1000, gain: -3 })],
      graphicGains: [-1, 0, 2, 1, -2],
      activePresetId: null,
    }),
    [bluetooth.key]: createEQRouteProfile(bluetooth, {
      enabled: false,
      preamp: 0,
      mode: 'parametric',
      bands: [band({ frequency: 4000, gain: 5, enabled: false })],
      graphicGains: [0, 0, 0, 0, 0],
      activePresetId: 'vocal',
    }),
  };

  const parsed = parseEQRouteProfilesJson(stringifyEQRouteProfiles(profiles), nextId);

  assert.equal(restoreEQRouteProfile(parsed.speaker, () => true).bands[0]?.gain, 4);
  assert.equal(restoreEQRouteProfile(parsed.wired, () => true).mode, 'graphic');
  assert.deepEqual(restoreEQRouteProfile(parsed.wired, () => true).graphicGains, [-1, 0, 2, 1, -2]);
  assert.equal(restoreEQRouteProfile(parsed['bluetooth:sony-wh-1000xm5'], () => true).enabled, false);
  assert.equal(restoreEQRouteProfile(parsed['bluetooth:sony-wh-1000xm5'], () => true).bands[0]?.enabled, false);
});

test('drops deleted preset references but keeps the stored EQ shape', () => {
  const profile = createEQRouteProfile(route({ key: 'speaker' }), {
    enabled: true,
    preamp: -1,
    mode: 'parametric',
    bands: [band({ frequency: 1200, gain: 2.5 })],
    graphicGains: [0, 0, 0, 0, 0],
    activePresetId: 'deleted-custom',
  });

  const restored = restoreEQRouteProfile(profile, () => false);

  assert.equal(restored.activePresetId, null);
  assert.equal(restored.bands[0]?.frequency, 1200);
  assert.equal(restored.bands[0]?.gain, 2.5);
});

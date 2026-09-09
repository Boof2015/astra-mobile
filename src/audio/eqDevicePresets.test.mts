import assert from 'node:assert/strict';
import test from 'node:test';
import type { AudioOutputRoute } from '../types/audio.ts';
import type { EQRouteProfile } from './eqRouteProfiles.ts';
import {
  migrateLegacyEQRouteProfiles,
  observeEQOutputDevice,
  parseEQDevicePresetStateJson,
  presetForOutputRouteTransition,
  pruneEQDevicePresetAssignments,
  removePresetDeviceAssignments,
  replacePresetDeviceAssignments,
  stringifyEQDevicePresetState,
  type EQDevicePresetState,
} from './eqDevicePresets.ts';

function state(overrides: Partial<EQDevicePresetState> = {}): EQDevicePresetState {
  return {
    version: 1,
    devices: overrides.devices ?? {
      speaker: { key: 'speaker', label: 'Phone speaker', kind: 'speaker', lastSeenAt: 1 },
      'bluetooth:name:sony': {
        key: 'bluetooth:name:sony',
        label: 'Sony',
        kind: 'bluetooth',
        lastSeenAt: 2,
      },
    },
    assignments: overrides.assignments ?? {},
  };
}

function route(overrides: Partial<AudioOutputRoute> = {}): AudioOutputRoute {
  return {
    key: overrides.key ?? 'speaker',
    label: overrides.label ?? 'Phone speaker',
    kind: overrides.kind ?? 'speaker',
    nativeType: overrides.nativeType ?? null,
    nativeId: overrides.nativeId ?? null,
    selectedRouteName: overrides.selectedRouteName ?? null,
    updatedAt: overrides.updatedAt ?? 1,
  };
}

test('recovers from corrupt device assignment storage', () => {
  assert.deepEqual(parseEQDevicePresetStateJson('{not-json'), {
    version: 1,
    devices: {},
    assignments: {},
  });
  assert.deepEqual(parseEQDevicePresetStateJson(JSON.stringify({ version: 99 })), {
    version: 1,
    devices: {},
    assignments: {},
  });
});

test('round-trips known devices and valid assignments', () => {
  const source = state({ assignments: { speaker: 'flat' } });
  assert.deepEqual(parseEQDevicePresetStateJson(stringifyEQDevicePresetState(source)), source);
});

test('replaces one preset checklist and moves devices from other presets', () => {
  const source = state({
    assignments: {
      speaker: 'vocal',
      'bluetooth:name:sony': 'bass',
    },
  });
  const next = replacePresetDeviceAssignments(source, 'vocal', ['bluetooth:name:sony']);

  assert.deepEqual(next.assignments, { 'bluetooth:name:sony': 'vocal' });
  assert.deepEqual(removePresetDeviceAssignments(next, 'vocal').assignments, {});
});

test('prunes missing presets without dropping known devices', () => {
  const source = state({ assignments: { speaker: 'deleted', 'bluetooth:name:sony': 'vocal' } });
  const next = pruneEQDevicePresetAssignments(source, (presetId) => presetId === 'vocal');

  assert.deepEqual(next.devices, source.devices);
  assert.deepEqual(next.assignments, { 'bluetooth:name:sony': 'vocal' });
});

test('legacy route snapshots migrate only their device metadata', () => {
  const legacy: EQRouteProfile = {
    version: 1,
    routeKey: 'bluetooth:sony',
    routeLabel: 'Sony',
    routeKind: 'bluetooth',
    enabled: true,
    preamp: -6,
    mode: 'parametric',
    bands: [{ id: 'band', type: 'peaking', frequency: 1000, gain: 8, Q: 1, enabled: true }],
    graphicGains: [1, 2, 3, 4, 5],
    activePresetId: 'bass',
    updatedAt: 42,
  };
  const migrated = migrateLegacyEQRouteProfiles({ [legacy.routeKey]: legacy });

  assert.deepEqual(migrated.assignments, {});
  assert.deepEqual(migrated.devices[legacy.routeKey], {
    key: legacy.routeKey,
    label: 'Sony',
    kind: 'bluetooth',
    lastSeenAt: 42,
  });
  assert.equal('bands' in migrated.devices[legacy.routeKey], false);
});

test('observing a stronger native identity rekeys a migrated device', () => {
  const source = state({
    devices: {
      'bluetooth:sony': {
        key: 'bluetooth:sony',
        label: 'Sony',
        kind: 'bluetooth',
        lastSeenAt: 10,
      },
    },
  });
  const observed = observeEQOutputDevice(
    source,
    route({
      key: 'bluetooth:id:abc123',
      label: 'Sony',
      kind: 'bluetooth',
      updatedAt: 20,
    })
  );

  assert.equal(observed.devices['bluetooth:sony'], undefined);
  assert.deepEqual(observed.devices['bluetooth:id:abc123'], {
    key: 'bluetooth:id:abc123',
    label: 'Sony',
    kind: 'bluetooth',
    lastSeenAt: 20,
  });
});

test('only a real transition to an assigned device requests preset application', () => {
  const assignments = { speaker: 'vocal' };
  const exists = (presetId: string) => presetId === 'vocal';

  assert.equal(presetForOutputRouteTransition(null, 'speaker', assignments, exists), 'vocal');
  assert.equal(presetForOutputRouteTransition('speaker', 'speaker', assignments, exists), null);
  assert.equal(presetForOutputRouteTransition('wired', 'bluetooth', assignments, exists), null);
  assert.equal(presetForOutputRouteTransition('wired', 'speaker', assignments, () => false), null);
});

test('USB product names refresh stored devices without losing or reapplying their presets', () => {
  for (const key of ['usb:id:abc123', 'usb', 'usb:name:my-dac']) {
    const previous = state({
      devices: { [key]: { key, label: 'USB', kind: 'usb', lastSeenAt: 10 } },
      assignments: { [key]: 'dac-preset' },
    });
    const observed = observeEQOutputDevice(previous, route({
      key,
      label: 'SNOWSKY TINY B',
      kind: 'usb',
      updatedAt: 20,
    }));

    assert.deepEqual(Object.keys(observed.devices), [key]);
    assert.equal(observed.devices[key].label, 'SNOWSKY TINY B');
    assert.deepEqual(observed.assignments, previous.assignments);
    assert.equal(presetForOutputRouteTransition(key, key, observed.assignments, () => true), null);
    assert.equal(presetForOutputRouteTransition('speaker', key, observed.assignments, () => true), 'dac-preset');
    assert.deepEqual(parseEQDevicePresetStateJson(stringifyEQDevicePresetState(observed)), observed);
  }
});

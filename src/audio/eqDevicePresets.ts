import type { AudioOutputRoute, AudioOutputRouteKind } from '../types/audio.ts';
import type { EQRouteProfile } from './eqRouteProfiles.ts';

export const EQ_DEVICE_PRESET_STATE_VERSION = 1;

export interface KnownEQOutputDevice {
  key: string;
  label: string;
  kind: AudioOutputRouteKind;
  lastSeenAt: number;
}

export interface EQDevicePresetState {
  version: typeof EQ_DEVICE_PRESET_STATE_VERSION;
  devices: Record<string, KnownEQOutputDevice>;
  assignments: Record<string, string>;
}

const KNOWN_DEVICE_SEEN_WRITE_INTERVAL_MS = 60_000;

function isRouteKind(value: unknown): value is AudioOutputRouteKind {
  return (
    value === 'speaker' ||
    value === 'wired' ||
    value === 'bluetooth' ||
    value === 'usb' ||
    value === 'hdmi' ||
    value === 'unknown'
  );
}

function trim(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const out = value.trim();
  return out.length > 0 ? out : null;
}

function timestamp(value: unknown, fallback = Date.now()): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.trunc(parsed)) : fallback;
}

function slug(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function emptyState(): EQDevicePresetState {
  return {
    version: EQ_DEVICE_PRESET_STATE_VERSION,
    devices: {},
    assignments: {},
  };
}

function parseDevice(value: unknown, key: string): KnownEQOutputDevice | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const raw = value as Partial<KnownEQOutputDevice>;
  const label = trim(raw.label);
  if (!label || !isRouteKind(raw.kind) || raw.kind === 'unknown') return null;
  return {
    key,
    label,
    kind: raw.kind,
    lastSeenAt: timestamp(raw.lastSeenAt),
  };
}

/** Invalid fields are dropped independently so one bad device cannot erase the list. */
export function parseEQDevicePresetState(value: unknown): EQDevicePresetState {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return emptyState();
  const raw = value as Partial<EQDevicePresetState>;
  if (raw.version !== EQ_DEVICE_PRESET_STATE_VERSION) return emptyState();

  const devices: Record<string, KnownEQOutputDevice> = {};
  if (raw.devices && typeof raw.devices === 'object' && !Array.isArray(raw.devices)) {
    for (const [rawKey, rawDevice] of Object.entries(raw.devices)) {
      const key = trim(rawKey);
      if (!key) continue;
      const device = parseDevice(rawDevice, key);
      if (device) devices[key] = device;
    }
  }

  const assignments: Record<string, string> = {};
  if (raw.assignments && typeof raw.assignments === 'object' && !Array.isArray(raw.assignments)) {
    for (const [rawDeviceKey, rawPresetId] of Object.entries(raw.assignments)) {
      const deviceKey = trim(rawDeviceKey);
      const presetId = trim(rawPresetId);
      if (deviceKey && presetId && devices[deviceKey]) assignments[deviceKey] = presetId;
    }
  }

  return {
    version: EQ_DEVICE_PRESET_STATE_VERSION,
    devices,
    assignments,
  };
}

export function parseEQDevicePresetStateJson(json: string | null): EQDevicePresetState {
  if (!json) return emptyState();
  try {
    return parseEQDevicePresetState(JSON.parse(json));
  } catch {
    return emptyState();
  }
}

export function stringifyEQDevicePresetState(state: EQDevicePresetState): string {
  return JSON.stringify({
    version: EQ_DEVICE_PRESET_STATE_VERSION,
    devices: state.devices,
    assignments: state.assignments,
  } satisfies EQDevicePresetState);
}

/**
 * The old route snapshot format is intentionally reduced to device history.
 * Its bands, enable state, and preset references must never become assignments.
 */
export function migrateLegacyEQRouteProfiles(
  profiles: Record<string, EQRouteProfile>
): EQDevicePresetState {
  const devices: Record<string, KnownEQOutputDevice> = {};
  for (const [key, profile] of Object.entries(profiles)) {
    if (profile.routeKind === 'unknown') continue;
    devices[key] = {
      key,
      label: profile.routeLabel,
      kind: profile.routeKind,
      lastSeenAt: timestamp(profile.updatedAt),
    };
  }
  return {
    version: EQ_DEVICE_PRESET_STATE_VERSION,
    devices,
    assignments: {},
  };
}

function legacyRouteKey(kind: AudioOutputRouteKind, label: string): string {
  if (kind === 'bluetooth') {
    const labelSlug = slug(label);
    if (
      labelSlug &&
      labelSlug !== 'bluetooth' &&
      labelSlug !== 'bluetooth-audio' &&
      labelSlug !== 'headphones' &&
      labelSlug !== 'headset'
    ) {
      return `bluetooth:${labelSlug}`;
    }
  }
  return kind;
}

/** Records a resolved output without exposing route history to the live EQ state. */
export function observeEQOutputDevice(
  state: EQDevicePresetState,
  route: AudioOutputRoute
): EQDevicePresetState {
  if (route.kind === 'unknown' || route.key === 'unknown') return state;

  let devices = state.devices;
  let assignments = state.assignments;

  // Re-key a device retained from the old label/class-based snapshot format the
  // first time the native module supplies its stronger address/name identity.
  const oldKey = legacyRouteKey(route.kind, route.label);
  if (oldKey !== route.key && devices[oldKey] && !devices[route.key]) {
    const { [oldKey]: legacyDevice, ...remainingDevices } = devices;
    devices = remainingDevices;
    const { [oldKey]: legacyAssignment, ...remainingAssignments } = assignments;
    assignments = legacyAssignment
      ? { ...remainingAssignments, [route.key]: legacyAssignment }
      : remainingAssignments;
    void legacyDevice;
  }

  const previous = devices[route.key];
  const labelChanged = previous?.label !== route.label || previous?.kind !== route.kind;
  const lastSeenChanged =
    !previous || route.updatedAt - previous.lastSeenAt >= KNOWN_DEVICE_SEEN_WRITE_INTERVAL_MS;
  if (previous && !labelChanged && !lastSeenChanged && devices === state.devices) return state;

  return {
    version: EQ_DEVICE_PRESET_STATE_VERSION,
    devices: {
      ...devices,
      [route.key]: {
        key: route.key,
        label: route.label,
        kind: route.kind,
        lastSeenAt: Math.max(previous?.lastSeenAt ?? 0, route.updatedAt),
      },
    },
    assignments,
  };
}

export function pruneEQDevicePresetAssignments(
  state: EQDevicePresetState,
  presetExists: (presetId: string) => boolean
): EQDevicePresetState {
  const assignments: Record<string, string> = {};
  for (const [deviceKey, presetId] of Object.entries(state.assignments)) {
    if (state.devices[deviceKey] && presetExists(presetId)) assignments[deviceKey] = presetId;
  }
  if (
    Object.keys(assignments).length === Object.keys(state.assignments).length &&
    Object.entries(assignments).every(([key, value]) => state.assignments[key] === value)
  ) {
    return state;
  }
  return { ...state, assignments };
}

/** Replaces one preset's device checklist and moves selected devices atomically. */
export function replacePresetDeviceAssignments(
  state: EQDevicePresetState,
  presetId: string,
  selectedDeviceKeys: readonly string[]
): EQDevicePresetState {
  const assignments: Record<string, string> = {};
  for (const [deviceKey, assignedPresetId] of Object.entries(state.assignments)) {
    if (assignedPresetId !== presetId) assignments[deviceKey] = assignedPresetId;
  }
  for (const deviceKey of new Set(selectedDeviceKeys)) {
    if (state.devices[deviceKey]) assignments[deviceKey] = presetId;
  }
  return { ...state, assignments };
}

export function removePresetDeviceAssignments(
  state: EQDevicePresetState,
  presetId: string
): EQDevicePresetState {
  const assignments = Object.fromEntries(
    Object.entries(state.assignments).filter(([, assignedPresetId]) => assignedPresetId !== presetId)
  );
  return { ...state, assignments };
}

/** Same-route events only refresh metadata; they must not erase live manual edits. */
export function presetForOutputRouteTransition(
  previousDeviceKey: string | null,
  nextDeviceKey: string,
  assignments: Readonly<Record<string, string>>,
  presetExists: (presetId: string) => boolean
): string | null {
  if (previousDeviceKey === nextDeviceKey) return null;
  const presetId = assignments[nextDeviceKey];
  return presetId && presetExists(presetId) ? presetId : null;
}

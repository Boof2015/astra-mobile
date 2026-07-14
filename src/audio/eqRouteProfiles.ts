import type {
  AudioOutputRoute,
  AudioOutputRouteKind,
  EQBand,
  EQMode,
} from '../types/audio.ts';
import {
  EQ_GRAPHIC_BAND_COUNT,
  EQ_MAX_BANDS,
  clampPreamp,
  createNormalizedEQBand,
} from './eq.ts';

export const EQ_ROUTE_PROFILE_VERSION = 1;
export const DEFAULT_AUDIO_OUTPUT_ROUTE_KEY = 'default';

export interface EQRouteProfile {
  version: typeof EQ_ROUTE_PROFILE_VERSION;
  routeKey: string;
  routeLabel: string;
  routeKind: AudioOutputRouteKind;
  enabled: boolean;
  preamp: number;
  mode: EQMode;
  bands: EQBand[];
  graphicGains: number[];
  activePresetId: string | null;
  updatedAt: number;
}

export interface EQRouteProfileEnvelope {
  version: typeof EQ_ROUTE_PROFILE_VERSION;
  profiles: Record<string, EQRouteProfile>;
}

export interface EQRouteProfileState {
  enabled: boolean;
  preamp: number;
  mode: EQMode;
  bands: EQBand[];
  graphicGains: number[];
  activePresetId: string | null;
}

function isRouteKind(value: unknown): value is AudioOutputRouteKind {
  return (
    value === 'speaker' ||
    value === 'wired' ||
    value === 'bluetooth' ||
    value === 'usb' ||
    value === 'hdmi' ||
    value === 'remote' ||
    value === 'unknown'
  );
}

function trim(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const out = value.trim();
  return out.length > 0 ? out : null;
}

function finiteNumber(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function slug(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function defaultRouteLabel(kind: AudioOutputRouteKind): string {
  switch (kind) {
    case 'speaker':
      return 'Phone speaker';
    case 'wired':
      return 'Wired headphones';
    case 'bluetooth':
      return 'Bluetooth';
    case 'usb':
      return 'USB audio';
    case 'hdmi':
      return 'HDMI audio';
    case 'remote':
      return 'Remote audio';
    default:
      return 'Unknown output';
  }
}

function isGenericExternalLabel(kind: AudioOutputRouteKind, label: string): boolean {
  const normalized = slug(label);
  if (normalized.length === 0) return true;
  if (kind === 'bluetooth') {
    return (
      normalized === 'bluetooth' ||
      normalized === 'bluetooth-audio' ||
      normalized === 'headphones' ||
      normalized === 'headset'
    );
  }
  if (kind === 'usb') return normalized === 'usb' || normalized === 'usb-audio';
  if (kind === 'hdmi') return normalized === 'hdmi' || normalized === 'hdmi-audio';
  return true;
}

export function buildAudioOutputRouteKey(kind: AudioOutputRouteKind, label: string | null): string {
  if (
    (kind === 'bluetooth' || kind === 'usb' || kind === 'hdmi') &&
    label &&
    !isGenericExternalLabel(kind, label)
  ) {
    return `${kind}:name:${slug(label)}`;
  }
  switch (kind) {
    case 'speaker':
      return 'speaker';
    case 'wired':
      return 'wired';
    case 'bluetooth':
      return 'bluetooth';
    case 'usb':
      return 'usb';
    case 'hdmi':
      return 'hdmi';
    case 'remote':
      return 'remote';
    default:
      return 'unknown';
  }
}

export function normalizeAudioOutputRoute(value: unknown): AudioOutputRoute | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const raw = value as Partial<AudioOutputRoute>;
  const kind = isRouteKind(raw.kind) ? raw.kind : 'unknown';
  const label = trim(raw.label) ?? defaultRouteLabel(kind);
  const key = trim(raw.key) ?? buildAudioOutputRouteKey(kind, label);
  const nativeType = finiteNumber(raw.nativeType);
  const nativeId = finiteNumber(raw.nativeId);
  return {
    key,
    label,
    kind,
    nativeType: nativeType === null ? null : Math.trunc(nativeType),
    nativeId: nativeId === null ? null : Math.trunc(nativeId),
    selectedRouteName: trim(raw.selectedRouteName),
    updatedAt: Math.max(0, Math.trunc(finiteNumber(raw.updatedAt) ?? Date.now())),
  };
}

/** A known kind or a concrete native type is enough to apply the loaded EQ safely. */
export function isAudioOutputRouteUsable(route: AudioOutputRoute): boolean {
  return route.kind !== 'unknown' || route.nativeType != null;
}

function normalizeBands(value: unknown, createId: () => string): EQBand[] | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  return value
    .slice(0, EQ_MAX_BANDS)
    .map((band) =>
      createNormalizedEQBand(
        band && typeof band === 'object' && !Array.isArray(band) ? (band as object) : {},
        createId()
      )
    );
}

function normalizeGraphicGains(value: unknown): number[] | null {
  if (!Array.isArray(value) || value.length !== EQ_GRAPHIC_BAND_COUNT) return null;
  const out: number[] = [];
  for (const raw of value) {
    const gain = finiteNumber(raw);
    if (gain === null) return null;
    out.push(Math.max(-12, Math.min(12, gain)));
  }
  return out;
}

function parseProfile(value: unknown, createId: () => string): EQRouteProfile | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const raw = value as Partial<EQRouteProfile>;
  if (raw.version !== EQ_ROUTE_PROFILE_VERSION) return null;
  const routeKey = trim(raw.routeKey);
  if (!routeKey) return null;
  const routeKind = isRouteKind(raw.routeKind) ? raw.routeKind : 'unknown';
  const routeLabel = trim(raw.routeLabel) ?? defaultRouteLabel(routeKind);
  const bands = normalizeBands(raw.bands, createId);
  if (!bands) return null;
  const mode: EQMode = raw.mode === 'graphic' ? 'graphic' : 'parametric';
  const graphicGains = normalizeGraphicGains(raw.graphicGains);
  if (!graphicGains) return null;
  return {
    version: EQ_ROUTE_PROFILE_VERSION,
    routeKey,
    routeLabel,
    routeKind,
    enabled: raw.enabled === true,
    preamp: clampPreamp(finiteNumber(raw.preamp) ?? 0),
    mode,
    bands,
    graphicGains,
    activePresetId: trim(raw.activePresetId),
    updatedAt: Math.max(0, Math.trunc(finiteNumber(raw.updatedAt) ?? Date.now())),
  };
}

export function parseEQRouteProfiles(value: unknown, createId: () => string): Record<string, EQRouteProfile> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const raw = value as Partial<EQRouteProfileEnvelope> & { profiles?: unknown };
  const source = raw.profiles && typeof raw.profiles === 'object' && !Array.isArray(raw.profiles)
    ? raw.profiles
    : value;
  const out: Record<string, EQRouteProfile> = {};
  for (const [key, profileValue] of Object.entries(source)) {
    const profile = parseProfile(profileValue, createId);
    if (!profile) continue;
    out[key] = { ...profile, routeKey: key };
  }
  return out;
}

export function parseEQRouteProfilesJson(json: string | null, createId: () => string): Record<string, EQRouteProfile> {
  if (!json) return {};
  try {
    return parseEQRouteProfiles(JSON.parse(json), createId);
  } catch {
    return {};
  }
}

export function stringifyEQRouteProfiles(profiles: Record<string, EQRouteProfile>): string {
  const envelope: EQRouteProfileEnvelope = {
    version: EQ_ROUTE_PROFILE_VERSION,
    profiles,
  };
  return JSON.stringify(envelope);
}

export function createEQRouteProfile(
  route: AudioOutputRoute,
  state: EQRouteProfileState,
  updatedAt: number = Date.now()
): EQRouteProfile {
  return {
    version: EQ_ROUTE_PROFILE_VERSION,
    routeKey: route.key,
    routeLabel: route.label,
    routeKind: route.kind,
    enabled: state.enabled,
    preamp: clampPreamp(state.preamp),
    mode: state.mode,
    bands: state.bands.slice(0, EQ_MAX_BANDS).map((band) => ({ ...band })),
    graphicGains: state.graphicGains.slice(0, EQ_GRAPHIC_BAND_COUNT),
    activePresetId: state.activePresetId,
    updatedAt,
  };
}

export function restoreEQRouteProfile(
  profile: EQRouteProfile,
  presetExists: (presetId: string) => boolean
): EQRouteProfileState {
  const activePresetId =
    profile.activePresetId && presetExists(profile.activePresetId) ? profile.activePresetId : null;
  return {
    enabled: profile.enabled,
    preamp: profile.preamp,
    mode: profile.mode,
    bands: profile.bands.map((band) => ({ ...band })),
    graphicGains: [...profile.graphicGains],
    activePresetId,
  };
}

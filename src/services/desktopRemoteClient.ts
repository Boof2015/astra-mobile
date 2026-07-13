import * as Device from 'expo-device';
import {
  AstraDesktopTransport,
  desktopPinnedTransportAvailable,
} from '../../modules/astra-desktop-transport';
import type {
  DesktopRemoteControlCommand,
  DesktopRemoteIdentity,
  DesktopRemoteNowPlayingSnapshot,
  DesktopRemotePairingClaim,
  DesktopRemotePairingStatus,
  DesktopRemotePinPairingRequest,
  DesktopRemoteQueueSnapshot,
} from '@/types/desktopRemote';
import type {
  DesktopSyncApplyPayload,
  DesktopSyncApplyResult,
  DesktopSyncConflictReportPayload,
  DesktopSyncState,
} from '@/types/desktopSync';
export {
  parseDesktopRemoteManualInput,
  parseDesktopRemotePairingInput,
} from './desktopRemotePairing';

const REQUEST_TIMEOUT_MS = 8000;

interface JsonRequestOptions {
  method?: 'GET' | 'POST';
  token?: string | null;
  body?: unknown;
  timeoutMs?: number;
  fingerprint: string;
}

export class DesktopRemoteHttpError extends Error {
  status: number;
  payload: unknown;

  constructor(status: number, message: string, payload: unknown) {
    super(message);
    this.status = status;
    this.payload = payload;
  }
}

async function fetchJson<T>(
  baseUrl: string,
  path: string,
  options: JsonRequestOptions
): Promise<T> {
  if (!desktopPinnedTransportAvailable || !AstraDesktopTransport) {
    throw new Error('Secure Desktop Remote transport is unavailable on this device.');
  }
  const body = options.body === undefined ? null : JSON.stringify(options.body);
  const response = await AstraDesktopTransport.requestJson(
    baseUrl,
    path,
    options.method ?? (body ? 'POST' : 'GET'),
    body,
    options.token ?? null,
    options.fingerprint,
    options.timeoutMs ?? REQUEST_TIMEOUT_MS
  );
  const payload = response.body ? JSON.parse(response.body) as unknown : null;
  if (response.status < 200 || response.status >= 300) {
    const message =
      payload && typeof payload === 'object' && 'error' in payload && typeof payload.error === 'string'
        ? payload.error
        : `Desktop remote request failed (${response.status}).`;
    throw new DesktopRemoteHttpError(response.status, message, payload);
  }
  return payload as T;
}

function normalizeIdentity(payload: unknown): DesktopRemoteIdentity | null {
  if (!payload || typeof payload !== 'object') return null;
  const candidate = payload as Record<string, unknown>;
  return {
    endpointUuid: typeof candidate.endpointUuid === 'string' && candidate.endpointUuid.trim()
      ? candidate.endpointUuid.trim()
      : null,
    desktopName: typeof candidate.desktopName === 'string' && candidate.desktopName.trim()
      ? candidate.desktopName.trim()
      : null,
    protocolVersion:
      typeof candidate.protocolVersion === 'number' && Number.isFinite(candidate.protocolVersion)
        ? candidate.protocolVersion
        : 1,
    syncRequestedAt:
      typeof candidate.syncRequestedAt === 'number' && Number.isFinite(candidate.syncRequestedAt)
        ? candidate.syncRequestedAt
        : null,
  };
}

function clientLabel(): string {
  if (Device.osName === 'Android') return 'Android Phone';
  if (Device.osName === 'iOS') return Device.modelName?.includes('iPad') ? 'iPad' : 'iPhone';
  return 'Astra Mobile';
}

export function defaultDesktopRemoteDeviceName(): string {
  const model = Device.modelName?.trim();
  return model ? `${model} Remote` : 'Astra Mobile Remote';
}

export async function fetchDesktopRemoteIdentity(
  baseUrl: string,
  certificateFingerprint: string
): Promise<DesktopRemoteIdentity | null> {
  try {
    const payload = await fetchJson<unknown>(baseUrl, '/v1/identity', { fingerprint: certificateFingerprint });
    return normalizeIdentity(payload);
  } catch {
    return null;
  }
}

export async function claimDesktopRemotePairingTicket(
  baseUrl: string,
  ticket: string,
  certificateFingerprint: string,
  deviceName: string = defaultDesktopRemoteDeviceName()
): Promise<DesktopRemotePairingClaim> {
  const payload = await fetchJson<Record<string, unknown>>(baseUrl, '/v1/pairing/claim', {
    fingerprint: certificateFingerprint,
    method: 'POST',
    body: {
      ticket,
      deviceName,
      clientLabel: clientLabel(),
    },
  });
  return {
    requestId: String(payload.requestId ?? ''),
    pollToken: String(payload.pollToken ?? ''),
    expiresAt: typeof payload.expiresAt === 'number' ? payload.expiresAt : 0,
    deviceName: String(payload.deviceName ?? deviceName),
    clientLabel: String(payload.clientLabel ?? clientLabel()),
    identity: normalizeIdentity(payload.identity ?? payload),
  };
}

export async function requestDesktopRemotePinPairing(
  baseUrl: string,
  deviceName: string = defaultDesktopRemoteDeviceName()
): Promise<DesktopRemotePinPairingRequest> {
  if (!desktopPinnedTransportAvailable || !AstraDesktopTransport) {
    throw new Error('Secure Desktop Remote transport is unavailable on this device.');
  }
  const payload = await AstraDesktopTransport.beginPinPairing(baseUrl, deviceName, clientLabel());
  return {
    attemptId: payload.attemptId,
    requestId: payload.requestId,
    pollToken: '',
    expiresAt: payload.expiresAt,
    deviceName,
    clientLabel: clientLabel(),
    identity: { endpointUuid: null, desktopName: payload.desktopName, protocolVersion: 3 },
    certificateFingerprint: payload.certificateFingerprint,
    protocolVersion: 3,
  };
}

export async function confirmDesktopRemotePinPairing(
  attemptId: string,
  pin: string
): Promise<DesktopRemotePairingStatus> {
  if (!desktopPinnedTransportAvailable || !AstraDesktopTransport) {
    throw new Error('Secure Desktop Remote transport is unavailable on this device.');
  }
  const payload = await AstraDesktopTransport.confirmPinPairing(attemptId, pin);
  return {
    state: 'approved',
    expiresAt: 0,
    token: payload.controlToken,
    controlToken: payload.controlToken,
    syncToken: payload.syncToken,
    issuedAt: payload.issuedAt,
    scopes: ['control', 'sync'],
    certificateFingerprint: payload.certificateFingerprint,
    deviceId: payload.deviceId,
    identity: normalizeIdentity(JSON.parse(payload.identityJson)),
  };
}

export async function fetchDesktopRemotePairingStatus(
  baseUrl: string,
  pollToken: string,
  certificateFingerprint: string
): Promise<DesktopRemotePairingStatus> {
  const payload = await fetchJson<Record<string, unknown>>(
    baseUrl,
    `/v1/pairing/status?pollToken=${encodeURIComponent(pollToken)}`,
    { fingerprint: certificateFingerprint }
  );
  const state = typeof payload.state === 'string' ? payload.state : 'pending';
  return {
    state: state as DesktopRemotePairingStatus['state'],
    expiresAt: typeof payload.expiresAt === 'number' ? payload.expiresAt : 0,
    token: typeof payload.token === 'string' ? payload.token : undefined,
    controlToken: typeof payload.controlToken === 'string' ? payload.controlToken : undefined,
    syncToken: typeof payload.syncToken === 'string' ? payload.syncToken : undefined,
    issuedAt: typeof payload.issuedAt === 'number' ? payload.issuedAt : undefined,
    scopes: Array.isArray(payload.scopes)
      ? payload.scopes.filter((scope): scope is 'control' | 'sync' => scope === 'control' || scope === 'sync')
      : undefined,
    certificateFingerprint: typeof payload.certificateFingerprint === 'string' ? payload.certificateFingerprint : undefined,
    deviceId: typeof payload.deviceId === 'string' ? payload.deviceId : null,
    identity: normalizeIdentity(payload.identity ?? payload),
  };
}

export async function fetchDesktopRemoteNowPlaying(
  baseUrl: string,
  token: string,
  certificateFingerprint: string,
  inlineArtwork = false
): Promise<DesktopRemoteNowPlayingSnapshot> {
  return fetchJson<DesktopRemoteNowPlayingSnapshot>(
    baseUrl,
    `/v1/now-playing${inlineArtwork ? '?inlineArtwork=1' : ''}`,
    { token, fingerprint: certificateFingerprint }
  );
}

export async function sendDesktopRemoteControl(
  baseUrl: string,
  token: string,
  certificateFingerprint: string,
  command: DesktopRemoteControlCommand,
  time?: number
): Promise<void> {
  await fetchJson<{ ok: true }>(baseUrl, '/v1/control', {
    method: 'POST',
    token,
    fingerprint: certificateFingerprint,
    body: command === 'seek' ? { command, time } : { command },
  });
}

export async function sendDesktopRemotePlayQueueItem(
  baseUrl: string,
  token: string,
  certificateFingerprint: string,
  queueId: string
): Promise<void> {
  await fetchJson<{ ok: true }>(baseUrl, '/v1/control', {
    method: 'POST',
    token,
    fingerprint: certificateFingerprint,
    body: { command: 'play-queue-item', queueId },
  });
}

export async function fetchDesktopRemoteQueue(
  baseUrl: string,
  token: string,
  certificateFingerprint: string
): Promise<DesktopRemoteQueueSnapshot> {
  return fetchJson<DesktopRemoteQueueSnapshot>(baseUrl, '/v1/queue', { token, fingerprint: certificateFingerprint });
}

export interface DesktopRemoteSessionInfo {
  deviceId: string;
  scopes: ('control' | 'sync')[];
  issuedAt: number;
  rotatedAt: number;
  rotateAfter: number;
  rotateRequiredAt: number;
  expiresAt: number;
  rotationRequired: boolean;
  usingPreviousCredential: boolean;
}

export interface DesktopRemoteRotatedCredentials {
  controlToken: string;
  syncToken: string;
  issuedAt: number;
  previousValidUntil: number;
  rotateAfter: number;
}

export async function inspectDesktopRemoteSession(
  baseUrl: string,
  controlToken: string,
  certificateFingerprint: string
): Promise<DesktopRemoteSessionInfo> {
  return fetchJson<DesktopRemoteSessionInfo>(baseUrl, '/v1/session', {
    token: controlToken,
    fingerprint: certificateFingerprint,
  });
}

export async function rotateDesktopRemoteCredentials(
  baseUrl: string,
  controlToken: string,
  certificateFingerprint: string
): Promise<DesktopRemoteRotatedCredentials> {
  return fetchJson<DesktopRemoteRotatedCredentials>(baseUrl, '/v1/session/rotate', {
    method: 'POST',
    token: controlToken,
    fingerprint: certificateFingerprint,
    body: {},
  });
}

// ── Favorites/playlists LAN sync (protocolVersion >= 2) ──────────────────────
// Sync payloads can carry thousands of favorites/playlist entries, so both
// calls get generous timeouts compared to the 8 s control default.

export async function fetchDesktopSyncState(baseUrl: string, token: string, certificateFingerprint: string): Promise<DesktopSyncState> {
  return fetchJson<DesktopSyncState>(baseUrl, '/v1/sync/state', { token, fingerprint: certificateFingerprint, timeoutMs: 30_000 });
}

export async function postDesktopSyncApply(
  baseUrl: string,
  token: string,
  certificateFingerprint: string,
  payload: DesktopSyncApplyPayload
): Promise<DesktopSyncApplyResult> {
  return fetchJson<DesktopSyncApplyResult>(baseUrl, '/v1/sync/apply', {
    method: 'POST',
    token,
    fingerprint: certificateFingerprint,
    body: payload,
    timeoutMs: 60_000,
  });
}

export async function postDesktopSyncConflicts(
  baseUrl: string,
  token: string,
  certificateFingerprint: string,
  payload: DesktopSyncConflictReportPayload
): Promise<void> {
  await fetchJson<{ ok: true }>(baseUrl, '/v1/sync/conflicts', {
    method: 'POST',
    token,
    fingerprint: certificateFingerprint,
    body: payload,
  });
}

export type DesktopRemoteSseHandlers = {
  onSnapshot: (snapshot: DesktopRemoteNowPlayingSnapshot) => void;
  onQueue?: (queue: DesktopRemoteQueueSnapshot) => void;
  /** Desktop-initiated library-sync nudge (user clicked Sync Now / resolved a conflict there). */
  onSyncRequest?: () => void;
  onUnauthorized: () => void;
  onDisconnect: () => void;
  onError?: (error: unknown) => void;
};

export function startDesktopRemoteEventStream(
  baseUrl: string,
  token: string,
  certificateFingerprint: string,
  handlers: DesktopRemoteSseHandlers
): () => void {
  let closed = false;
  let streamId: string | null = null;
  const transport = AstraDesktopTransport;
  if (!transport) {
    handlers.onError?.(new Error('Secure Desktop Remote transport is unavailable on this device.'));
    return () => {};
  }

  const eventSubscription = transport.addListener('onDesktopTransportSse', (event) => {
    if (closed || !streamId || event.streamId !== streamId) return;
    if (event.event === 'now-playing') {
      try { handlers.onSnapshot(JSON.parse(event.data) as DesktopRemoteNowPlayingSnapshot); } catch { /* ignore */ }
    } else if (event.event === 'queue' && handlers.onQueue) {
      try { handlers.onQueue(JSON.parse(event.data) as DesktopRemoteQueueSnapshot); } catch { /* ignore */ }
    } else if (event.event === 'sync-request') {
      handlers.onSyncRequest?.();
    }
  });
  const closedSubscription = transport.addListener('onDesktopTransportClosed', (event) => {
    if (closed || !streamId || event.streamId !== streamId) return;
    if (event.unauthorized) handlers.onUnauthorized();
    else if (event.message) {
      handlers.onError?.(new Error(event.message));
      handlers.onDisconnect();
    }
  });

  void transport.startEventStream(baseUrl, token, certificateFingerprint).then((id) => {
    streamId = id;
    if (closed) transport.stopEventStream(id);
  }).catch((error) => {
    if (closed) return;
    handlers.onError?.(error);
    handlers.onDisconnect();
  });

  return () => {
    if (closed) return;
    closed = true;
    eventSubscription.remove();
    closedSubscription.remove();
    if (streamId) transport.stopEventStream(streamId);
  };
}

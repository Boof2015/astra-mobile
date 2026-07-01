import * as Device from 'expo-device';
import type {
  DesktopRemoteControlCommand,
  DesktopRemoteIdentity,
  DesktopRemoteNowPlayingSnapshot,
  DesktopRemotePairingClaim,
  DesktopRemotePairingStatus,
  DesktopRemotePinPairingRequest,
} from '@/types/desktopRemote';
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
  signal?: AbortSignal;
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

function timeoutSignal(timeoutMs: number, parentSignal?: AbortSignal): AbortSignal {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  const abort = () => controller.abort();
  if (parentSignal) {
    if (parentSignal.aborted) controller.abort();
    else parentSignal.addEventListener('abort', abort, { once: true });
  }

  controller.signal.addEventListener(
    'abort',
    () => {
      clearTimeout(timer);
      parentSignal?.removeEventListener('abort', abort);
    },
    { once: true }
  );

  return controller.signal;
}

async function fetchJson<T>(
  baseUrl: string,
  path: string,
  options: JsonRequestOptions = {}
): Promise<T> {
  const headers: Record<string, string> = {
    Accept: 'application/json',
  };
  let body: string | undefined;
  if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json; charset=utf-8';
    body = JSON.stringify(options.body);
  }
  if (options.token) headers.Authorization = `Bearer ${options.token}`;

  const response = await fetch(`${baseUrl}${path}`, {
    method: options.method ?? (body ? 'POST' : 'GET'),
    headers,
    body,
    cache: 'no-store',
    signal: timeoutSignal(options.timeoutMs ?? REQUEST_TIMEOUT_MS, options.signal),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
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

export async function fetchDesktopRemoteIdentity(baseUrl: string): Promise<DesktopRemoteIdentity | null> {
  try {
    const payload = await fetchJson<unknown>(baseUrl, '/v1/identity');
    return normalizeIdentity(payload);
  } catch {
    return null;
  }
}

export async function claimDesktopRemotePairingTicket(
  baseUrl: string,
  ticket: string,
  deviceName: string = defaultDesktopRemoteDeviceName()
): Promise<DesktopRemotePairingClaim> {
  const payload = await fetchJson<Record<string, unknown>>(baseUrl, '/v1/pairing/claim', {
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
  const payload = await fetchJson<Record<string, unknown>>(baseUrl, '/v1/pairing/pin-request', {
    method: 'POST',
    body: {
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

export async function confirmDesktopRemotePinPairing(
  baseUrl: string,
  requestId: string,
  pin: string
): Promise<DesktopRemotePairingStatus> {
  const payload = await fetchJson<Record<string, unknown>>(baseUrl, '/v1/pairing/pin-confirm', {
    method: 'POST',
    body: {
      requestId,
      pin,
    },
  });
  const state = typeof payload.state === 'string' ? payload.state : 'approved';
  return {
    state: state as DesktopRemotePairingStatus['state'],
    expiresAt: typeof payload.expiresAt === 'number' ? payload.expiresAt : 0,
    token: typeof payload.token === 'string' ? payload.token : undefined,
    deviceId: typeof payload.deviceId === 'string' ? payload.deviceId : null,
    identity: normalizeIdentity(payload.identity ?? payload),
  };
}

export async function fetchDesktopRemotePairingStatus(
  baseUrl: string,
  pollToken: string
): Promise<DesktopRemotePairingStatus> {
  const payload = await fetchJson<Record<string, unknown>>(
    baseUrl,
    `/v1/pairing/status?pollToken=${encodeURIComponent(pollToken)}`
  );
  const state = typeof payload.state === 'string' ? payload.state : 'pending';
  return {
    state: state as DesktopRemotePairingStatus['state'],
    expiresAt: typeof payload.expiresAt === 'number' ? payload.expiresAt : 0,
    token: typeof payload.token === 'string' ? payload.token : undefined,
    deviceId: typeof payload.deviceId === 'string' ? payload.deviceId : null,
    identity: normalizeIdentity(payload.identity ?? payload),
  };
}

export async function fetchDesktopRemoteNowPlaying(
  baseUrl: string,
  token: string,
  inlineArtwork = false
): Promise<DesktopRemoteNowPlayingSnapshot> {
  return fetchJson<DesktopRemoteNowPlayingSnapshot>(
    baseUrl,
    `/v1/now-playing${inlineArtwork ? '?inlineArtwork=1' : ''}`,
    { token }
  );
}

export async function sendDesktopRemoteControl(
  baseUrl: string,
  token: string,
  command: DesktopRemoteControlCommand,
  time?: number
): Promise<void> {
  await fetchJson<{ ok: true }>(baseUrl, '/v1/control', {
    method: 'POST',
    token,
    body: command === 'seek' ? { command, time } : { command },
  });
}

export type DesktopRemoteSseHandlers = {
  onSnapshot: (snapshot: DesktopRemoteNowPlayingSnapshot) => void;
  onUnauthorized: () => void;
  onDisconnect: () => void;
  onError?: (error: unknown) => void;
};

function processSseChunk(
  buffer: { value: string },
  chunk: string,
  onSnapshot: (snapshot: DesktopRemoteNowPlayingSnapshot) => void
): void {
  buffer.value += chunk.replace(/\r/g, '');
  let boundary = buffer.value.indexOf('\n\n');
  while (boundary !== -1) {
    const raw = buffer.value.slice(0, boundary);
    buffer.value = buffer.value.slice(boundary + 2);
    let eventName = 'message';
    const data: string[] = [];
    for (const line of raw.split('\n')) {
      if (!line || line.startsWith(':')) continue;
      if (line.startsWith('event:')) {
        eventName = line.slice(6).trim();
        continue;
      }
      if (line.startsWith('data:')) data.push(line.slice(5).trimStart());
    }
    if (eventName === 'now-playing' && data.length > 0) {
      try {
        onSnapshot(JSON.parse(data.join('\n')) as DesktopRemoteNowPlayingSnapshot);
      } catch {
        // Ignore a malformed event; polling/reconnect will correct the UI.
      }
    }
    boundary = buffer.value.indexOf('\n\n');
  }
}

export function startDesktopRemoteEventStream(
  baseUrl: string,
  token: string,
  handlers: DesktopRemoteSseHandlers
): () => void {
  const controller = new AbortController();
  let closed = false;

  void (async () => {
    try {
      const response = await fetch(`${baseUrl}/v1/events`, {
        headers: {
          Accept: 'text/event-stream',
          Authorization: `Bearer ${token}`,
        },
        cache: 'no-store',
        signal: controller.signal,
      });
      if (response.status === 401) {
        handlers.onUnauthorized();
        return;
      }
      const body = response.body as unknown as {
        getReader?: () => {
          read: () => Promise<{ done: boolean; value?: Uint8Array }>;
        };
      } | null;
      if (!response.ok || !body?.getReader) throw new Error(`SSE unavailable (${response.status})`);

      const reader = body.getReader();
      const decoder = new TextDecoder();
      const buffer = { value: '' };
      while (!closed) {
        const next = await reader.read();
        if (next.done) break;
        if (next.value) processSseChunk(buffer, decoder.decode(next.value, { stream: true }), handlers.onSnapshot);
      }
      processSseChunk(buffer, decoder.decode(), handlers.onSnapshot);
      if (!closed) handlers.onDisconnect();
    } catch (error) {
      if (closed || controller.signal.aborted) return;
      handlers.onError?.(error);
      handlers.onDisconnect();
    }
  })();

  return () => {
    closed = true;
    controller.abort();
  };
}

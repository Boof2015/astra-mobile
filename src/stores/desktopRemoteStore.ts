import { create } from 'zustand';
import {
  AstraDesktopDiscovery,
  desktopRemoteDiscoveryAvailable,
} from '@/services/desktopRemoteDiscovery';
import {
  DesktopRemoteHttpError,
  claimDesktopRemotePairingTicket,
  confirmDesktopRemotePinPairing,
  defaultDesktopRemoteDeviceName,
  fetchDesktopRemoteIdentity,
  fetchDesktopRemoteNowPlaying,
  fetchDesktopRemotePairingStatus,
  parseDesktopRemoteManualInput,
  parseDesktopRemotePairingInput,
  requestDesktopRemotePinPairing,
  sendDesktopRemoteControl,
  startDesktopRemoteEventStream,
} from '@/services/desktopRemoteClient';
import { normalizeDesktopRemotePinInput } from '@/services/desktopRemotePairing';
import {
  clearDesktopRemotePairing,
  getDesktopRemoteConnection,
  getDesktopRemoteToken,
  setDesktopRemoteConnection,
  setDesktopRemoteToken,
} from '@/services/desktopRemoteCredentials';
import type {
  DesktopRemoteConnection,
  DesktopRemoteControlCommand,
  DesktopRemoteDiscoveredDesktop,
  DesktopRemoteIdentity,
  DesktopRemoteNowPlayingSnapshot,
} from '@/types/desktopRemote';

const PAIR_POLL_INTERVAL_MS = 1500;
const SNAPSHOT_POLL_INTERVAL_MS = 5000;
const RECONNECT_DELAY_MS = 2000;

export type DesktopRemoteConnectionState =
  | 'unpaired'
  | 'pairing'
  | 'pinEntry'
  | 'pendingApproval'
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'error';

interface PairingAttempt {
  baseUrl: string;
  pollToken: string;
  expiresAt: number;
}

interface PinPairingAttempt {
  baseUrl: string;
  requestId: string;
  expiresAt: number;
  desktopName: string | null;
}

interface DesktopRemoteStore {
  initialized: boolean;
  connectionState: DesktopRemoteConnectionState;
  connection: DesktopRemoteConnection | null;
  token: string | null;
  snapshot: DesktopRemoteNowPlayingSnapshot | null;
  discovered: DesktopRemoteDiscoveredDesktop[];
  discoveryAvailable: boolean;
  discoveryRunning: boolean;
  pairing: PairingAttempt | null;
  pinPairing: PinPairingAttempt | null;
  message: string;
  errorMessage: string;

  init: () => Promise<void>;
  startDiscovery: () => Promise<void>;
  stopDiscovery: () => Promise<void>;
  requestPinPairing: (baseUrl: string) => Promise<void>;
  confirmPinPairing: (pin: string) => Promise<void>;
  pairFromInput: (input: string) => Promise<void>;
  pairManual: (baseUrl: string, ticket: string) => Promise<void>;
  connect: () => Promise<boolean>;
  reconnect: () => Promise<void>;
  disconnect: () => void;
  forget: () => Promise<void>;
  sendControl: (command: DesktopRemoteControlCommand, time?: number) => Promise<void>;
}

let pairingPollTimer: ReturnType<typeof setTimeout> | null = null;
let snapshotPollTimer: ReturnType<typeof setInterval> | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let stopEventStream: (() => void) | null = null;
let discoverySubscriptions: { remove: () => void }[] = [];
let inlineArtworkRequestKey: string | null = null;

function clearPairingPoll(): void {
  if (pairingPollTimer !== null) {
    clearTimeout(pairingPollTimer);
    pairingPollTimer = null;
  }
}

function clearSnapshotPoll(): void {
  if (snapshotPollTimer !== null) {
    clearInterval(snapshotPollTimer);
    snapshotPollTimer = null;
  }
}

function clearReconnect(): void {
  if (reconnectTimer !== null) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
}

function stopRealtime(): void {
  stopEventStream?.();
  stopEventStream = null;
  clearSnapshotPoll();
  clearReconnect();
}

function displayName(identity: DesktopRemoteIdentity | null, baseUrl: string): string {
  return identity?.desktopName?.trim() || new URL(baseUrl).hostname || 'Astra Desktop';
}

function stableConnectionId(identity: DesktopRemoteIdentity | null, baseUrl: string): string {
  return identity?.endpointUuid?.trim() || baseUrl;
}

function errorMessage(error: unknown): string {
  if (error instanceof DesktopRemoteHttpError) return error.message;
  if (error instanceof Error && error.message.trim()) return error.message;
  return 'Desktop remote request failed.';
}

function mergeSnapshotArtwork(
  previous: DesktopRemoteNowPlayingSnapshot | null,
  next: DesktopRemoteNowPlayingSnapshot
): DesktopRemoteNowPlayingSnapshot {
  const previousTrack = previous?.currentTrack ?? null;
  const nextTrack = next.currentTrack ?? null;
  if (!previousTrack || !nextTrack) return next;
  if (previousTrack.id !== nextTrack.id) return next;
  if (nextTrack.artworkDataUrl || !previousTrack.artworkDataUrl) return next;
  return {
    ...next,
    currentTrack: {
      ...nextTrack,
      artworkDataUrl: previousTrack.artworkDataUrl,
    },
  };
}

async function persistConnectedDesktop(
  baseUrl: string,
  token: string,
  deviceId: string | null,
  identity: DesktopRemoteIdentity | null
): Promise<DesktopRemoteConnection> {
  const resolvedIdentity = identity ?? (await fetchDesktopRemoteIdentity(baseUrl));
  const now = Date.now();
  const connection: DesktopRemoteConnection = {
    id: stableConnectionId(resolvedIdentity, baseUrl),
    baseUrl,
    endpointUuid: resolvedIdentity?.endpointUuid ?? null,
    desktopName: displayName(resolvedIdentity, baseUrl),
    protocolVersion: resolvedIdentity?.protocolVersion ?? 1,
    deviceId,
    pairedAt: now,
    lastConnectedAt: now,
  };
  await Promise.all([
    setDesktopRemoteConnection(connection),
    setDesktopRemoteToken(token),
  ]);
  return connection;
}

export const useDesktopRemoteStore = create<DesktopRemoteStore>((set, get) => {
  const refreshInlineArtwork = () => {
    const { connection, token, snapshot } = get();
    const track = snapshot?.currentTrack ?? null;
    if (!connection || !token || !track || track.artworkDataUrl) return;
    const requestKey = `${connection.id}:${track.id}`;
    if (inlineArtworkRequestKey === requestKey) return;
    inlineArtworkRequestKey = requestKey;
    void fetchDesktopRemoteNowPlaying(connection.baseUrl, token, true).then(
      (inlineSnapshot) => {
        inlineArtworkRequestKey = null;
        set((state) => ({
          snapshot: mergeSnapshotArtwork(state.snapshot, inlineSnapshot),
          connectionState: 'connected',
          errorMessage: '',
        }));
      },
      () => {
        inlineArtworkRequestKey = null;
      }
    );
  };

  const scheduleSnapshotPoll = () => {
    clearSnapshotPoll();
    snapshotPollTimer = setInterval(() => {
      const { connection, token, connectionState } = get();
      if (!connection || !token || connectionState === 'connecting') return;
      void fetchDesktopRemoteNowPlaying(connection.baseUrl, token).then(
        (snapshot) => {
          set((state) => ({
            snapshot: mergeSnapshotArtwork(state.snapshot, snapshot),
            connectionState: 'connected',
            errorMessage: '',
          }));
          refreshInlineArtwork();
        },
        (error) => {
          if (error instanceof DesktopRemoteHttpError && error.status === 401) {
            void get().forget();
            set({ errorMessage: 'Desktop pairing was revoked.' });
            return;
          }
          if (get().connectionState === 'connected') {
            set({ connectionState: 'reconnecting', message: 'Reconnecting to desktop...' });
          }
        }
      );
    }, SNAPSHOT_POLL_INTERVAL_MS);
  };

  const scheduleReconnect = () => {
    clearReconnect();
    const { connection, token } = get();
    if (!connection || !token) return;
    set({ connectionState: 'reconnecting', message: 'Reconnecting to desktop...' });
    scheduleSnapshotPoll();
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      void get().connect();
    }, RECONNECT_DELAY_MS);
  };

  const pollPairingStatus = async () => {
    const pairing = get().pairing;
    if (!pairing) return;
    try {
      const status = await fetchDesktopRemotePairingStatus(pairing.baseUrl, pairing.pollToken);
      if (status.state === 'approved' && status.token?.trim()) {
        clearPairingPoll();
        const connection = await persistConnectedDesktop(
          pairing.baseUrl,
          status.token.trim(),
          status.deviceId ?? null,
          status.identity ?? null
        );
        set({
          connection,
          token: status.token.trim(),
          pairing: null,
          pinPairing: null,
          connectionState: 'connecting',
          message: 'Paired. Connecting...',
          errorMessage: '',
        });
        void get().connect();
        return;
      }
      if (status.state === 'rejected') {
        clearPairingPoll();
        set({
          pairing: null,
          connectionState: 'error',
          message: '',
          errorMessage: 'Desktop rejected this pairing request.',
        });
        return;
      }
      if (status.state === 'expired' || status.state === 'consumed') {
        clearPairingPoll();
        set({
          pairing: null,
          connectionState: 'error',
          message: '',
          errorMessage: 'Pairing link expired. Generate a new QR code on desktop.',
        });
        return;
      }
      set({
        connectionState: 'pendingApproval',
        pairing: { ...pairing, expiresAt: status.expiresAt || pairing.expiresAt },
        message: 'Approve this phone in Astra on desktop.',
      });
      pairingPollTimer = setTimeout(() => void pollPairingStatus(), PAIR_POLL_INTERVAL_MS);
    } catch (error) {
      clearPairingPoll();
      set({
        pairing: null,
        connectionState: 'error',
        message: '',
        errorMessage: errorMessage(error),
      });
    }
  };

  const claimPairing = async (baseUrl: string, ticket: string) => {
    clearPairingPoll();
    stopRealtime();
    set({
      connectionState: 'pairing',
      pairing: null,
      pinPairing: null,
      snapshot: null,
      message: 'Starting pairing...',
      errorMessage: '',
    });
    try {
      const claim = await claimDesktopRemotePairingTicket(
        baseUrl,
        ticket,
        defaultDesktopRemoteDeviceName()
      );
      if (!claim.pollToken) throw new Error('Desktop did not return a pairing poll token.');
      set({
        connectionState: 'pendingApproval',
        pairing: {
          baseUrl,
          pollToken: claim.pollToken,
          expiresAt: claim.expiresAt,
        },
        message: 'Approve this phone in Astra on desktop.',
      });
      await pollPairingStatus();
    } catch (error) {
      set({
        connectionState: 'error',
        pairing: null,
        pinPairing: null,
        message: '',
        errorMessage: errorMessage(error),
      });
    }
  };

  const requestPinPairing = async (baseUrl: string) => {
    clearPairingPoll();
    stopRealtime();
    set({
      connectionState: 'pairing',
      pairing: null,
      pinPairing: null,
      snapshot: null,
      message: 'Requesting PIN from desktop...',
      errorMessage: '',
    });
    try {
      const request = await requestDesktopRemotePinPairing(baseUrl, defaultDesktopRemoteDeviceName());
      if (!request.requestId) throw new Error('Desktop did not return a PIN pairing request.');
      const desktopName = request.identity?.desktopName?.trim() || null;
      set({
        connectionState: 'pinEntry',
        pinPairing: {
          baseUrl,
          requestId: request.requestId,
          expiresAt: request.expiresAt,
          desktopName,
        },
        message: `Enter the PIN shown on ${desktopName || 'Astra Desktop'}.`,
        errorMessage: '',
      });
    } catch (error) {
      set({
        connectionState: 'error',
        pinPairing: null,
        message: '',
        errorMessage: errorMessage(error),
      });
    }
  };

  const confirmPinPairing = async (pin: string) => {
    const normalizedPin = normalizeDesktopRemotePinInput(pin);
    const attempt = get().pinPairing;
    if (!attempt) return;
    if (!normalizedPin) {
      set({ errorMessage: 'Enter the 6-digit PIN shown on desktop.' });
      return;
    }
    set({ connectionState: 'pairing', message: 'Confirming PIN...', errorMessage: '' });
    try {
      const status = await confirmDesktopRemotePinPairing(attempt.baseUrl, attempt.requestId, normalizedPin);
      if (status.state !== 'approved' || !status.token?.trim()) {
        throw new Error('Desktop did not approve this PIN pairing.');
      }
      const connection = await persistConnectedDesktop(
        attempt.baseUrl,
        status.token.trim(),
        status.deviceId ?? null,
        status.identity ?? null
      );
      set({
        connection,
        token: status.token.trim(),
        pairing: null,
        pinPairing: null,
        connectionState: 'connecting',
        message: 'Paired. Connecting...',
        errorMessage: '',
      });
      void get().connect();
    } catch (error) {
      if (error instanceof DesktopRemoteHttpError && error.status === 401) {
        set({
          connectionState: 'pinEntry',
          message: `Enter the PIN shown on ${attempt.desktopName || 'Astra Desktop'}.`,
          errorMessage: 'Wrong PIN. Try again.',
        });
        return;
      }
      set({
        connectionState: 'error',
        pinPairing: null,
        message: '',
        errorMessage: errorMessage(error),
      });
    }
  };

  return {
    initialized: false,
    connectionState: 'unpaired',
    connection: null,
    token: null,
    snapshot: null,
    discovered: [],
    discoveryAvailable: desktopRemoteDiscoveryAvailable,
    discoveryRunning: false,
    pairing: null,
    pinPairing: null,
    message: '',
    errorMessage: '',

    init: async () => {
      if (get().initialized) return;
      const [connection, token] = await Promise.all([
        getDesktopRemoteConnection(),
        getDesktopRemoteToken(),
      ]);
      set({
        initialized: true,
        connection,
        token,
        connectionState: connection && token ? 'connecting' : 'unpaired',
      });
      if (connection && token) void get().connect();
    },

    startDiscovery: async () => {
      if (!desktopRemoteDiscoveryAvailable || get().discoveryRunning) return;
      if (discoverySubscriptions.length === 0) {
        discoverySubscriptions = [
          AstraDesktopDiscovery.addListener('onDesktopRemoteFound', (desktop) => {
            set((state) => {
              const byKey = new Map(state.discovered.map((item) => [item.endpointUuid || item.baseUrl, item]));
              byKey.set(desktop.endpointUuid || desktop.baseUrl, desktop);
              return {
                discovered: Array.from(byKey.values()).sort((left, right) =>
                  left.name.localeCompare(right.name)
                ),
              };
            });
          }),
          AstraDesktopDiscovery.addListener('onDesktopRemoteLost', (event) => {
            set((state) => ({
              discovered: state.discovered.filter((item) => item.name !== event.name),
            }));
          }),
        ];
      }
      set({ discoveryRunning: true, discovered: AstraDesktopDiscovery.getCached() });
      await AstraDesktopDiscovery.start();
    },

    stopDiscovery: async () => {
      if (!get().discoveryRunning) return;
      await AstraDesktopDiscovery.stop();
      set({ discoveryRunning: false });
    },

    requestPinPairing,

    confirmPinPairing,

    pairFromInput: async (input: string) => {
      const parsed = parseDesktopRemotePairingInput(input);
      if (!parsed || !parsed.baseUrl) {
        set({
          connectionState: 'error',
          errorMessage: 'Paste or scan a full desktop pairing link.',
        });
        return;
      }
      await claimPairing(parsed.baseUrl, parsed.ticket);
    },

    pairManual: async (baseUrl: string, ticket: string) => {
      const parsed = parseDesktopRemoteManualInput(baseUrl, ticket);
      if (!parsed) {
        set({
          connectionState: 'error',
          errorMessage: 'Enter a valid desktop URL and pairing code.',
        });
        return;
      }
      await claimPairing(parsed.baseUrl, parsed.ticket);
    },

    connect: async () => {
      const { connection, token } = get();
      if (!connection || !token) {
        set({ connectionState: 'unpaired' });
        return false;
      }
      stopRealtime();
      set({ connectionState: 'connecting', message: 'Connecting to desktop...', errorMessage: '' });
      try {
        const snapshot = await fetchDesktopRemoteNowPlaying(connection.baseUrl, token, true);
        const nextConnection = { ...connection, lastConnectedAt: Date.now() };
        await setDesktopRemoteConnection(nextConnection);
        set({
          connection: nextConnection,
          snapshot,
          connectionState: 'connected',
          message: '',
          errorMessage: '',
        });
        stopEventStream = startDesktopRemoteEventStream(connection.baseUrl, token, {
          onSnapshot: (nextSnapshot) => {
            set((state) => ({
              snapshot: mergeSnapshotArtwork(state.snapshot, nextSnapshot),
              connectionState: 'connected',
              message: '',
              errorMessage: '',
            }));
            refreshInlineArtwork();
          },
          onUnauthorized: () => {
            void get().forget();
            set({ errorMessage: 'Desktop pairing was revoked.' });
          },
          onDisconnect: scheduleReconnect,
          onError: () => {
            scheduleSnapshotPoll();
          },
        });
        scheduleSnapshotPoll();
        return true;
      } catch (error) {
        if (error instanceof DesktopRemoteHttpError && error.status === 401) {
          await get().forget();
          set({ errorMessage: 'Desktop pairing was revoked.' });
          return false;
        }
        set({
          connectionState: 'error',
          message: '',
          errorMessage: errorMessage(error),
        });
        scheduleReconnect();
        return false;
      }
    },

    reconnect: async () => {
      await get().connect();
    },

    disconnect: () => {
      stopRealtime();
      clearPairingPoll();
      set({ connectionState: get().connection ? 'error' : 'unpaired', message: '', snapshot: null, pinPairing: null });
    },

    forget: async () => {
      stopRealtime();
      clearPairingPoll();
      await clearDesktopRemotePairing();
      set({
        connectionState: 'unpaired',
        connection: null,
        token: null,
        snapshot: null,
        pairing: null,
        pinPairing: null,
        message: '',
      });
    },

    sendControl: async (command, time) => {
      const { connection, token } = get();
      if (!connection || !token) return;
      try {
        await sendDesktopRemoteControl(connection.baseUrl, token, command, time);
        set({ errorMessage: '' });
        if (command === 'seek' && typeof time === 'number') {
          set((state) => state.snapshot
            ? { snapshot: { ...state.snapshot, currentTime: time, updatedAt: Date.now() } }
            : {});
        }
      } catch (error) {
        if (error instanceof DesktopRemoteHttpError && error.status === 401) {
          await get().forget();
          set({ errorMessage: 'Desktop pairing was revoked.' });
          return;
        }
        set({ errorMessage: errorMessage(error) });
      }
    },
  };
});

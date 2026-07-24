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
  fetchDesktopRemoteQueue,
  parseDesktopRemotePairingInput,
  requestDesktopRemotePinPairing,
  sendDesktopRemoteControl,
  sendDesktopRemotePlayQueueItem,
  startDesktopRemoteEventStream,
} from '@/services/desktopRemoteClient';
import { normalizeDesktopRemotePinInput } from '@/services/desktopRemotePairing';
import {
  clearDesktopRemotePairing,
  clearDesktopRemoteSecurityUpgradeNotice,
  getDesktopRemoteCredentials,
  getDesktopRemoteConnection,
  getDesktopRemoteSecurityUpgradeNotice,
  setDesktopRemoteConnection,
  setDesktopRemoteCredentials,
} from '@/services/desktopRemoteCredentials';
import { AstraLibraryData } from '../../modules/astra-library-scanner';
import { useDesktopSyncStore } from '@/stores/desktopSyncStore';
import { identityMatchesPinnedConnection } from '@/services/desktopSyncPolicy';
import { ensureDesktopRemoteCredentialsFresh } from '@/services/desktopRemoteSession';
import { usePlaybackTargetStore } from '@/stores/playbackTargetStore';
import type {
  DesktopRemoteConnection,
  DesktopRemoteControlCommand,
  DesktopRemoteDiscoveredDesktop,
  DesktopRemoteIdentity,
  DesktopRemoteNowPlayingSnapshot,
  DesktopRemoteQueueSnapshot,
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
  certificateFingerprint: string;
  endpointUuid: string;
}

interface PinPairingAttempt {
  baseUrl: string;
  requestId: string;
  attemptId: string;
  expiresAt: number;
  desktopName: string | null;
}

interface DesktopRemoteStore {
  initialized: boolean;
  connectionState: DesktopRemoteConnectionState;
  connection: DesktopRemoteConnection | null;
  token: string | null;
  snapshot: DesktopRemoteNowPlayingSnapshot | null;
  /** Desktop queue (current + upcoming); null on protocol-1 desktops. */
  queue: DesktopRemoteQueueSnapshot | null;
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
  pairManual: (baseUrl: string) => Promise<void>;
  connect: () => Promise<boolean>;
  reconnect: () => Promise<void>;
  disconnect: () => void;
  forget: () => Promise<void>;
  sendControl: (command: DesktopRemoteControlCommand, time?: number) => Promise<void>;
  refreshQueue: () => Promise<void>;
  playQueueItem: (queueId: string) => Promise<void>;
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

function isDesktopCertificateError(error: unknown): boolean {
  const message = error instanceof Error ? error.message.toLowerCase() : '';
  return message.includes('certificate changed') ||
    message.includes('certificate mismatch') ||
    message.includes('pinning failure');
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
  credentials: { controlToken: string; syncToken: string; issuedAt: number },
  certificateFingerprint: string,
  deviceId: string | null,
  identity: DesktopRemoteIdentity | null,
  expectedEndpointUuid?: string
): Promise<DesktopRemoteConnection> {
  const resolvedIdentity = identity ?? (await fetchDesktopRemoteIdentity(baseUrl, certificateFingerprint));
  if (!resolvedIdentity || resolvedIdentity.protocolVersion !== 3) {
    throw new Error('Desktop does not support secure protocol v3.');
  }
  if (expectedEndpointUuid && resolvedIdentity.endpointUuid !== expectedEndpointUuid) {
    throw new Error('Desktop identity does not match the pairing QR.');
  }
  const now = Date.now();
  const connection: DesktopRemoteConnection = {
    id: stableConnectionId(resolvedIdentity, baseUrl),
    baseUrl,
    certificateFingerprint,
    scopes: ['control', 'sync'],
    credentialIssuedAt: credentials.issuedAt,
    credentialRotatedAt: credentials.issuedAt,
    securityUpgradeState: 'none',
    endpointUuid: resolvedIdentity?.endpointUuid ?? null,
    desktopName: displayName(resolvedIdentity, baseUrl),
    protocolVersion: 3,
    deviceId,
    pairedAt: now,
    lastConnectedAt: now,
  };
  await Promise.all([
    setDesktopRemoteConnection(connection),
    setDesktopRemoteCredentials(credentials),
    clearDesktopRemoteSecurityUpgradeNotice(),
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
    void fetchDesktopRemoteNowPlaying(connection.baseUrl, token, connection.certificateFingerprint, true).then(
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
      void fetchDesktopRemoteNowPlaying(connection.baseUrl, token, connection.certificateFingerprint).then(
        (snapshot) => {
          const wasConnected = get().connectionState === 'connected';
          set((state) => ({
            snapshot: mergeSnapshotArtwork(state.snapshot, snapshot),
            connectionState: 'connected',
            errorMessage: '',
          }));
          if (!wasConnected) {
            useDesktopSyncStore.getState().maybeAutoSync('connected');
          }
          refreshInlineArtwork();
        },
        (error) => {
          if (isDesktopCertificateError(error)) {
            void get().forget().then(() => set({ errorMessage: 'Desktop certificate changed—pair again.' }));
            return;
          }
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
      const status = await fetchDesktopRemotePairingStatus(
        pairing.baseUrl,
        pairing.pollToken,
        pairing.certificateFingerprint
      );
      const controlToken = status.controlToken?.trim() || status.token?.trim();
      const syncToken = status.syncToken?.trim();
      if (status.state === 'approved' && controlToken && syncToken) {
        clearPairingPoll();
        const connection = await persistConnectedDesktop(
          pairing.baseUrl,
          { controlToken, syncToken, issuedAt: status.issuedAt ?? Date.now() },
          pairing.certificateFingerprint,
          status.deviceId ?? null,
          status.identity ?? null,
          pairing.endpointUuid
        );
        set({
          connection,
          token: controlToken,
          pairing: null,
          pinPairing: null,
          connectionState: 'connecting',
          message: 'Paired. Connecting...',
          errorMessage: '',
        });
        void usePlaybackTargetStore.getState().setTarget('desktop');
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

  const claimPairing = async (
    baseUrl: string,
    ticket: string,
    certificateFingerprint: string,
    endpointUuid: string
  ) => {
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
        certificateFingerprint,
        defaultDesktopRemoteDeviceName()
      );
      if (!claim.pollToken) throw new Error('Desktop did not return a pairing poll token.');
      set({
        connectionState: 'pendingApproval',
        pairing: {
          baseUrl,
          pollToken: claim.pollToken,
          expiresAt: claim.expiresAt,
          certificateFingerprint,
          endpointUuid,
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
          attemptId: request.attemptId,
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
      const status = await confirmDesktopRemotePinPairing(attempt.attemptId, normalizedPin);
      const controlToken = status.controlToken?.trim() || status.token?.trim();
      const syncToken = status.syncToken?.trim();
      if (status.state !== 'approved' || !controlToken || !syncToken || !status.certificateFingerprint) {
        throw new Error('Desktop did not approve this PIN pairing.');
      }
      const connection = await persistConnectedDesktop(
        attempt.baseUrl,
        { controlToken, syncToken, issuedAt: status.issuedAt ?? Date.now() },
        status.certificateFingerprint,
        status.deviceId ?? null,
        status.identity ?? null
      );
      set({
        connection,
        token: controlToken,
        pairing: null,
        pinPairing: null,
        connectionState: 'connecting',
        message: 'Paired. Connecting...',
        errorMessage: '',
      });
      void usePlaybackTargetStore.getState().setTarget('desktop');
      void get().connect();
    } catch (error) {
      if (
        (error instanceof DesktopRemoteHttpError && error.status === 401) ||
        errorMessage(error).toLowerCase().includes('wrong pin')
      ) {
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
    queue: null,
    discovered: [],
    discoveryAvailable: desktopRemoteDiscoveryAvailable,
    discoveryRunning: false,
    pairing: null,
    pinPairing: null,
    message: '',
    errorMessage: '',

    init: async () => {
      if (get().initialized) return;
      const [connection, credentials, securityUpgradeLabel] = await Promise.all([
        getDesktopRemoteConnection(),
        getDesktopRemoteCredentials(),
        getDesktopRemoteSecurityUpgradeNotice(),
      ]);
      const token = credentials?.controlToken ?? null;
      set({
        initialized: true,
        connection,
        token,
        connectionState: connection && token ? 'connecting' : 'unpaired',
        errorMessage: securityUpgradeLabel
          ? `Security upgrade required—pair again. Previously paired: ${securityUpgradeLabel}.`
          : '',
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
            const connection = get().connection;
            if (
              connection?.endpointUuid && desktop.endpointUuid === connection.endpointUuid &&
              desktop.baseUrl !== connection.baseUrl
            ) {
              void fetchDesktopRemoteIdentity(desktop.baseUrl, connection.certificateFingerprint).then(async (identity) => {
                if (!identity || !identityMatchesPinnedConnection(
                  connection.endpointUuid,
                  identity.protocolVersion,
                  identity.endpointUuid
                )) return;
                const nextConnection = { ...connection, baseUrl: desktop.baseUrl };
                await setDesktopRemoteConnection(nextConnection);
                set({ connection: nextConnection });
              });
            }
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
      await claimPairing(
        parsed.baseUrl,
        parsed.ticket,
        parsed.certificateFingerprint,
        parsed.endpointUuid
      );
    },

    pairManual: async (baseUrl: string) => {
      if (!baseUrl.trim().toLowerCase().startsWith('https://')) {
        set({
          connectionState: 'error',
          errorMessage: 'Enter the HTTPS desktop URL shown by Astra.',
        });
        return;
      }
      await requestPinPairing(baseUrl.trim().replace(/\/+$/, ''));
    },

    connect: async () => {
      let { connection, token } = get();
      if (!connection || !token) {
        set({ connectionState: 'unpaired' });
        return false;
      }
      stopRealtime();
      set({ connectionState: 'connecting', message: 'Connecting to desktop...', errorMessage: '' });
      try {
        const storedCredentials = await getDesktopRemoteCredentials();
        if (!storedCredentials) throw new Error('Desktop credentials are unavailable. Pair again.');
        const fresh = await ensureDesktopRemoteCredentialsFresh(connection, storedCredentials);
        connection = fresh.connection;
        token = fresh.credentials.controlToken;
        const snapshot = await fetchDesktopRemoteNowPlaying(
          connection.baseUrl,
          token,
          connection.certificateFingerprint,
          true
        );
        const nextConnection = { ...connection, lastConnectedAt: Date.now() };
        await setDesktopRemoteConnection(nextConnection);
        set({
          connection: nextConnection,
          token,
          snapshot,
          connectionState: 'connected',
          message: '',
          errorMessage: '',
        });
        useDesktopSyncStore.getState().maybeAutoSync('connected');
        stopEventStream = startDesktopRemoteEventStream(
          connection.baseUrl,
          token,
          connection.certificateFingerprint,
          {
          onSnapshot: (nextSnapshot) => {
            const wasConnected = get().connectionState === 'connected';
            set((state) => ({
              snapshot: mergeSnapshotArtwork(state.snapshot, nextSnapshot),
              connectionState: 'connected',
              message: '',
              errorMessage: '',
            }));
            if (!wasConnected) {
              useDesktopSyncStore.getState().maybeAutoSync('connected');
            }
            refreshInlineArtwork();
          },
          onQueue: (queue) => {
            set({ queue });
          },
          onSyncRequest: () => {
            useDesktopSyncStore.getState().handleSyncRequest();
          },
          onUnauthorized: () => {
            void get().forget();
            set({ errorMessage: 'Desktop pairing was revoked.' });
          },
          onDisconnect: scheduleReconnect,
          onError: () => {
            scheduleSnapshotPoll();
          },
          }
        );
        scheduleSnapshotPoll();
        void get().refreshQueue();
        return true;
      } catch (error) {
        if (isDesktopCertificateError(error)) {
          await get().forget();
          set({ errorMessage: 'Desktop certificate changed—pair again.' });
          return false;
        }
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
      set({ connectionState: get().connection ? 'error' : 'unpaired', message: '', snapshot: null, queue: null, pinPairing: null });
    },

    forget: async () => {
      stopRealtime();
      clearPairingPoll();
      await clearDesktopRemotePairing();
      // Sync baselines are meaningless against a different desktop.
      void AstraLibraryData.clearDesktopSyncBaselines().catch(() => {});
      set({
        connectionState: 'unpaired',
        connection: null,
        token: null,
        snapshot: null,
        queue: null,
        pairing: null,
        pinPairing: null,
        message: '',
      });
      void usePlaybackTargetStore.getState().setTarget('phone');
    },

    sendControl: async (command, time) => {
      const { connection, token } = get();
      if (!connection || !token) return;
      try {
        await sendDesktopRemoteControl(
          connection.baseUrl,
          token,
          connection.certificateFingerprint,
          command,
          time
        );
        set({ errorMessage: '' });
        if (command === 'seek' && typeof time === 'number') {
          set((state) => state.snapshot
            ? { snapshot: { ...state.snapshot, currentTime: time, updatedAt: Date.now() } }
            : {});
        }
      } catch (error) {
        if (isDesktopCertificateError(error)) {
          await get().forget();
          set({ errorMessage: 'Desktop certificate changed—pair again.' });
          return;
        }
        if (error instanceof DesktopRemoteHttpError && error.status === 401) {
          await get().forget();
          set({ errorMessage: 'Desktop pairing was revoked.' });
          return;
        }
        set({ errorMessage: errorMessage(error) });
      }
    },

    refreshQueue: async () => {
      const { connection, token } = get();
      if (!connection || !token) return;
      try {
        const queue = await fetchDesktopRemoteQueue(
          connection.baseUrl,
          token,
          connection.certificateFingerprint
        );
        set({ queue });
      } catch (error) {
        if (isDesktopCertificateError(error)) {
          await get().forget();
          set({ errorMessage: 'Desktop certificate changed—pair again.' });
        }
        // Protocol-1 desktops 404 here; the queue UI simply stays hidden.
      }
    },

    playQueueItem: async (queueId) => {
      const { connection, token } = get();
      if (!connection || !token) return;
      try {
        await sendDesktopRemotePlayQueueItem(
          connection.baseUrl,
          token,
          connection.certificateFingerprint,
          queueId
        );
        set({ errorMessage: '' });
      } catch (error) {
        if (isDesktopCertificateError(error)) {
          await get().forget();
          set({ errorMessage: 'Desktop certificate changed—pair again.' });
          return;
        }
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

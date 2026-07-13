export const DESKTOP_REMOTE_PROTOCOL_VERSION = 3;
export type DesktopRemoteCredentialScope = 'control' | 'sync';
export type DesktopRemoteSecurityUpgradeState = 'none' | 'repair-required';

export type DesktopRemotePlaybackState = 'stopped' | 'playing' | 'paused' | 'loading';
export type DesktopRemoteRepeatMode = 'none' | 'one' | 'all';
export type DesktopRemoteControlCommand =
  | 'play'
  | 'pause'
  | 'next'
  | 'previous'
  | 'toggle-favorite'
  | 'toggle-shuffle'
  | 'toggle-repeat'
  | 'seek';

export interface DesktopRemoteIdentity {
  endpointUuid: string | null;
  desktopName: string | null;
  protocolVersion: number;
  /** Set while a desktop-initiated library-sync request awaits pickup;
   *  read by the phone's periodic foreground probe. */
  syncRequestedAt?: number | null;
}

export interface DesktopRemoteConnection extends DesktopRemoteIdentity {
  protocolVersion: 3;
  id: string;
  baseUrl: string;
  certificateFingerprint: string;
  scopes: DesktopRemoteCredentialScope[];
  credentialIssuedAt: number;
  credentialRotatedAt: number;
  securityUpgradeState: DesktopRemoteSecurityUpgradeState;
  deviceId: string | null;
  pairedAt: number;
  lastConnectedAt: number | null;
}

export interface DesktopRemoteTrackSnapshot {
  id: string;
  title: string;
  artist: string;
  artists: string[];
  album: string;
  albumArtists: string[];
  isFavorite: boolean;
  artworkUrl: string | null;
  artworkDataUrl: string | null;
}

export interface DesktopRemoteNowPlayingSnapshot {
  playbackState: DesktopRemotePlaybackState;
  currentTime: number;
  duration: number;
  queueLength: number;
  /** Absent on protocol-1 desktops — the UI hides the shuffle/repeat controls. */
  shuffle?: boolean;
  repeat?: DesktopRemoteRepeatMode;
  outputDeviceLabel: string | null;
  visualizerLineColor: string;
  currentTrack: DesktopRemoteTrackSnapshot | null;
  updatedAt: number;
}

export interface DesktopRemoteQueueItem {
  queueId: string;
  title: string;
  artist: string;
  durationSeconds: number | null;
  isCurrent: boolean;
}

export interface DesktopRemoteQueueSnapshot {
  items: DesktopRemoteQueueItem[];
  updatedAt: number;
}

export interface DesktopRemotePairingClaim {
  requestId: string;
  pollToken: string;
  expiresAt: number;
  deviceName: string;
  clientLabel: string;
  identity: DesktopRemoteIdentity | null;
}

export interface DesktopRemotePinPairingRequest extends DesktopRemotePairingClaim {
  attemptId: string;
  certificateFingerprint: string;
  protocolVersion: 3;
}

export type DesktopRemotePairingState =
  | 'pending'
  | 'approved'
  | 'rejected'
  | 'expired'
  | 'consumed';

export interface DesktopRemotePairingStatus {
  state: DesktopRemotePairingState;
  expiresAt: number;
  token?: string;
  controlToken?: string;
  syncToken?: string;
  issuedAt?: number;
  scopes?: DesktopRemoteCredentialScope[];
  certificateFingerprint?: string;
  deviceId?: string | null;
  identity?: DesktopRemoteIdentity | null;
}

export interface DesktopRemotePairingInput {
  baseUrl: string;
  ticket: string;
  endpointUuid: string;
  protocolVersion: 3;
  certificateFingerprint: string;
}

export interface DesktopRemoteDiscoveredDesktop extends DesktopRemoteIdentity {
  name: string;
  baseUrl: string;
  certificateFingerprint: string;
  transport: 'https';
  address: string;
  port: number;
  lastSeenAt: number;
}

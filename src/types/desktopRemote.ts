export const DESKTOP_REMOTE_PROTOCOL_VERSION = 1;

export type DesktopRemotePlaybackState = 'stopped' | 'playing' | 'paused' | 'loading';
export type DesktopRemoteControlCommand =
  | 'play'
  | 'pause'
  | 'next'
  | 'previous'
  | 'toggle-favorite'
  | 'seek';

export interface DesktopRemoteIdentity {
  endpointUuid: string | null;
  desktopName: string | null;
  protocolVersion: number;
}

export interface DesktopRemoteConnection extends DesktopRemoteIdentity {
  id: string;
  baseUrl: string;
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
  outputDeviceLabel: string | null;
  visualizerLineColor: string;
  currentTrack: DesktopRemoteTrackSnapshot | null;
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

export type DesktopRemotePinPairingRequest = DesktopRemotePairingClaim;

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
  deviceId?: string | null;
  identity?: DesktopRemoteIdentity | null;
}

export interface DesktopRemotePairingInput {
  baseUrl: string;
  ticket: string;
}

export interface DesktopRemoteDiscoveredDesktop extends DesktopRemoteIdentity {
  name: string;
  baseUrl: string;
  address: string;
  port: number;
  lastSeenAt: number;
}

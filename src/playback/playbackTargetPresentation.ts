import type { PlaybackState, Track } from '@/types/audio';
import type {
  DesktopRemoteConnection,
  DesktopRemoteNowPlayingSnapshot,
} from '@/types/desktopRemote';
import type { DesktopRemoteConnectionState } from '@/stores/desktopRemoteStore';
import type { PlaybackTarget } from '@/stores/playbackTargetStore';

export interface PlaybackPresentation {
  target: PlaybackTarget;
  sourceLabel: string;
  deviceLabel: string;
  title: string;
  subtitle: string;
  artworkUri: string | null;
  playbackState: PlaybackState;
  currentTime: number;
  duration: number;
  trackKey: string | null;
  hasTrack: boolean;
  visible: boolean;
}

export function getEffectivePlaybackPresentation({
  selectedTarget,
  phone,
  desktop,
}: {
  selectedTarget: PlaybackTarget;
  phone: PlaybackPresentation;
  desktop: PlaybackPresentation;
}): PlaybackPresentation {
  if (selectedTarget === 'desktop') return desktop;
  if (!phone.visible && desktop.hasTrack) return desktop;
  return phone;
}

export function desktopConnectionLabel(state: DesktopRemoteConnectionState): string {
  switch (state) {
    case 'connected':
      return 'Live';
    case 'connecting':
      return 'Connecting';
    case 'reconnecting':
      return 'Retrying';
    case 'pinEntry':
      return 'PIN required';
    case 'pendingApproval':
      return 'Waiting for approval';
    case 'pairing':
      return 'Pairing';
    case 'error':
      return 'Offline';
    default:
      return 'Not paired';
  }
}

export function hostFromBaseUrl(baseUrl: string): string {
  try {
    return new URL(baseUrl).host;
  } catch {
    return baseUrl;
  }
}

export function getPhonePlaybackPresentation({
  track,
  playbackState,
  currentTime,
  duration,
}: {
  track: Track | null;
  playbackState: PlaybackState;
  currentTime: number;
  duration: number;
}): PlaybackPresentation {
  return {
    target: 'phone',
    sourceLabel: track?.album?.trim() || 'This phone',
    deviceLabel: 'This phone',
    title: track?.title || 'Nothing playing',
    subtitle: track?.artist || 'Start a track from Home',
    artworkUri: track?.artworkData ?? null,
    playbackState,
    currentTime,
    duration,
    trackKey: track?.path ?? null,
    hasTrack: Boolean(track),
    visible: Boolean(track),
  };
}

export function getDesktopPlaybackPresentation({
  connection,
  connectionState,
  snapshot,
}: {
  connection: DesktopRemoteConnection | null;
  connectionState: DesktopRemoteConnectionState;
  snapshot: DesktopRemoteNowPlayingSnapshot | null;
}): PlaybackPresentation {
  const currentTrack = snapshot?.currentTrack ?? null;
  const desktopName = connection?.desktopName?.trim() || 'Astra Desktop';
  const status = desktopConnectionLabel(connectionState);
  return {
    target: 'desktop',
    sourceLabel: desktopName,
    deviceLabel: desktopName,
    title: currentTrack?.title || desktopName,
    subtitle:
      currentTrack?.artist ||
      currentTrack?.album ||
      snapshot?.outputDeviceLabel?.trim() ||
      (connection ? status : 'Pair to control desktop playback'),
    artworkUri: currentTrack?.artworkDataUrl || currentTrack?.artworkUrl || null,
    playbackState: snapshot?.playbackState === 'stopped' ? 'stopped' : snapshot?.playbackState ?? 'stopped',
    currentTime: snapshot?.currentTime ?? 0,
    duration: snapshot?.duration ?? 0,
    trackKey: currentTrack?.id ?? connection?.id ?? null,
    hasTrack: Boolean(currentTrack),
    visible: Boolean(connection || currentTrack),
  };
}

import {
  AstraDesktopRemoteSession,
  type AstraDesktopRemoteSessionCommand,
} from '../../modules/astra-desktop-remote-session';
import type {
  DesktopRemoteConnection,
  DesktopRemoteNowPlayingSnapshot,
} from '@/types/desktopRemote';

export function setDesktopRemoteMediaSession(
  snapshot: DesktopRemoteNowPlayingSnapshot | null,
  connection: DesktopRemoteConnection | null
): void {
  if (!snapshot?.currentTrack || !connection) {
    AstraDesktopRemoteSession.clear();
    return;
  }
  const track = snapshot.currentTrack;
  AstraDesktopRemoteSession.setNowPlaying({
    title: track.title,
    artist: track.artist,
    album: track.album,
    desktopName: connection.desktopName,
    artworkDataUrl: track.artworkDataUrl,
    playbackState: snapshot.playbackState,
    hasTrack: true,
    duration: snapshot.duration,
    position: snapshot.currentTime,
    updatedAt: snapshot.updatedAt,
    isFavorite: track.isFavorite,
  });
}

export function clearDesktopRemoteMediaSession(): void {
  AstraDesktopRemoteSession.clear();
}

export function subscribeDesktopRemoteMediaSessionCommands(
  handler: (command: AstraDesktopRemoteSessionCommand) => void
): { remove: () => void } {
  return AstraDesktopRemoteSession.addListener('onDesktopRemoteCommand', handler);
}

import TrackPlayer, { State, type Track as RntpTrack } from 'react-native-track-player';

import type { PlaybackState, Track } from '@/types/audio';
import { AstraCar } from '../../modules/astra-car';
import { usePlaylistStore } from '@/stores/playlistStore';

function mapRntpState(state?: State): PlaybackState {
  switch (state) {
    case State.Playing:
      return 'playing';
    case State.Buffering:
    case State.Loading:
      return 'loading';
    case State.Paused:
    case State.Ready:
      return 'paused';
    default:
      return 'stopped';
  }
}

type CarNowPlayingTrack = Pick<
  Track,
  'path' | 'title' | 'artist' | 'album' | 'artworkData' | 'duration' | 'sourceType' | 'sourceId' | 'artworkSourceId'
>;

/** True when the track should use its remote server cover (no local cache to serve). */
function isRemoteArt(track: CarNowPlayingTrack | null): boolean {
  return Boolean(
    track && track.sourceType && track.sourceType !== 'local' && track.sourceId != null && track.artworkSourceId,
  );
}

/** Local artwork is a `file://…/artwork/<hash>` URI — recover the cached file name. */
function localHashFromArtwork(artworkData: string | null | undefined): string | null {
  if (typeof artworkData !== 'string' || !artworkData.startsWith('file://')) return null;
  const name = artworkData.split('/').pop();
  if (!name) return null;
  try {
    return decodeURIComponent(name);
  } catch {
    return name;
  }
}

export function setCarNowPlaying(
  track: CarNowPlayingTrack | null,
  playbackState: PlaybackState,
  duration?: number | null,
  position?: number | null,
): void {
  // Android Auto loads art only from content:// URIs, so we pass structured identity
  // (local hash or remote source+id) and let the native module build the content URI.
  const remote = isRemoteArt(track);
  const trackPath = track?.path ?? null;
  AstraCar.setNowPlaying({
    title: track?.title ?? null,
    artist: track?.artist ?? null,
    album: track?.album ?? null,
    artworkHash: remote ? null : localHashFromArtwork(track?.artworkData),
    artworkSourceId: remote ? (track?.artworkSourceId ?? null) : null,
    artworkSourceKey: remote ? (track?.sourceId ?? null) : null,
    playbackState,
    hasTrack: Boolean(track),
    duration: duration ?? track?.duration ?? null,
    position: position ?? null,
    trackPath,
    isFavorite: trackPath ? usePlaylistStore.getState().favoritePaths.has(trackPath) : false,
  });
}

export function setCarNowPlayingFromRntpTrack(
  track: RntpTrack | null | undefined,
  playbackState: PlaybackState,
  duration?: number | null,
  position?: number | null,
): void {
  setCarNowPlaying(
    track
      ? {
          path: typeof track.astraPath === 'string' ? track.astraPath : String(track.url ?? track.id),
          title: track.title ?? 'Unknown title',
          artist: track.artist ?? 'Unknown artist',
          album: track.album ?? '',
          artworkData: typeof track.artwork === 'string' ? track.artwork : undefined,
          duration: typeof track.duration === 'number' ? track.duration : 0,
          sourceType: typeof track.sourceType === 'string' ? (track.sourceType as Track['sourceType']) : undefined,
          sourceId: typeof track.sourceId === 'number' ? track.sourceId : undefined,
          artworkSourceId: typeof track.artworkSourceId === 'string' ? track.artworkSourceId : undefined,
        }
      : null,
    playbackState,
    duration,
    position,
  );
}

export async function syncCarNowPlayingFromTrackPlayer(): Promise<void> {
  try {
    const [activeTrack, playbackState, progress] = await Promise.all([
      TrackPlayer.getActiveTrack(),
      TrackPlayer.getPlaybackState(),
      TrackPlayer.getProgress(),
    ]);
    setCarNowPlayingFromRntpTrack(
      activeTrack,
      mapRntpState(playbackState.state),
      progress.duration,
      progress.position,
    );
  } catch {
    setCarNowPlaying(null, 'stopped');
  }
}

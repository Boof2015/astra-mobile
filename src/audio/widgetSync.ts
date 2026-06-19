import TrackPlayer, { State, type Track as RntpTrack } from 'react-native-track-player';

import type { PlaybackState, Track } from '@/types/audio';
import type { DbTrack } from '@/types/library';
import { artworkThumbUri } from '@/library/artwork';
import { AstraWidget, type AstraWidgetRecentItem } from '../../modules/astra-widget';

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

export function setWidgetNowPlaying(
  track: Pick<Track, 'title' | 'artist' | 'artworkData'> | null,
  playbackState: PlaybackState,
  recentlyPlayed?: AstraWidgetRecentItem[],
): void {
  AstraWidget.setNowPlaying({
    title: track?.title ?? null,
    artist: track?.artist ?? null,
    artworkUri: track?.artworkData ?? null,
    playbackState,
    hasTrack: Boolean(track),
    ...(recentlyPlayed === undefined
      ? {}
      : {
          recentlyPlayed,
          replaceRecentlyPlayed: true,
        }),
  });
}

export function setWidgetNowPlayingFromRntpTrack(
  track: RntpTrack | null | undefined,
  playbackState: PlaybackState,
): void {
  setWidgetNowPlaying(
    track
      ? {
          title: track.title ?? 'Unknown title',
          artist: track.artist ?? 'Unknown artist',
          artworkData: typeof track.artwork === 'string' ? track.artwork : undefined,
        }
      : null,
    playbackState,
  );
}

export function buildWidgetRecentItems(
  tracks: readonly DbTrack[],
  currentPath?: string,
): AstraWidgetRecentItem[] {
  return tracks
    .filter((track) => track.path !== currentPath)
    .slice(0, 8)
    .map((track) => ({
      title: track.title,
      artist: track.artist,
      artworkUri: track.artwork_hash ? artworkThumbUri(track.artwork_hash) : null,
    }));
}

export async function syncWidgetNowPlayingFromTrackPlayer(): Promise<void> {
  try {
    const [activeTrack, playbackState] = await Promise.all([
      TrackPlayer.getActiveTrack(),
      TrackPlayer.getPlaybackState(),
    ]);
    setWidgetNowPlayingFromRntpTrack(activeTrack, mapRntpState(playbackState.state));
  } catch {
    setWidgetNowPlaying(null, 'stopped');
  }
}

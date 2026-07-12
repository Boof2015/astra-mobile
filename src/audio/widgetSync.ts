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

// Last payload actually handed to the native module. Every widget push builds
// RemoteViews + a Binder IPC to the launcher on the main thread, and seek/skip
// fire several state events carrying identical resolved payloads — dedupe here
// so both callers (UI hook + headless service) collapse to real changes only.
let lastPushed: {
  title: string | null;
  artist: string | null;
  artworkUri: string | null;
  playbackState: PlaybackState;
  hasTrack: boolean;
  recents: AstraWidgetRecentItem[] | null;
} | null = null;

function sameRecents(a: AstraWidgetRecentItem[], b: AstraWidgetRecentItem[] | null): boolean {
  if (!b || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (
      a[i].title !== b[i].title ||
      a[i].artist !== b[i].artist ||
      a[i].artworkUri !== b[i].artworkUri
    ) {
      return false;
    }
  }
  return true;
}

export function setWidgetNowPlaying(
  track: Pick<Track, 'title' | 'artist' | 'artworkData'> | null,
  playbackState: PlaybackState,
  recentlyPlayed?: AstraWidgetRecentItem[],
): void {
  const title = track?.title ?? null;
  const artist = track?.artist ?? null;
  const artworkUri = track?.artworkData ?? null;
  const hasTrack = Boolean(track);

  const coreSame =
    lastPushed != null &&
    lastPushed.title === title &&
    lastPushed.artist === artist &&
    lastPushed.artworkUri === artworkUri &&
    lastPushed.playbackState === playbackState &&
    lastPushed.hasTrack === hasTrack;
  // `recentlyPlayed === undefined` means "leave the recents as they are".
  const recentsSame =
    recentlyPlayed === undefined || (lastPushed != null && sameRecents(recentlyPlayed, lastPushed.recents));
  if (coreSame && recentsSame) return;

  AstraWidget.setNowPlaying({
    title,
    artist,
    artworkUri,
    playbackState,
    hasTrack,
    ...(recentlyPlayed === undefined
      ? {}
      : {
          recentlyPlayed,
          replaceRecentlyPlayed: true,
        }),
  });
  lastPushed = {
    title,
    artist,
    artworkUri,
    playbackState,
    hasTrack,
    recents: recentlyPlayed === undefined ? (lastPushed?.recents ?? null) : recentlyPlayed,
  };
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

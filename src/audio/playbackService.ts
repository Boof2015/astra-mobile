import TrackPlayer, { Event } from 'react-native-track-player';
import { syncWidgetNowPlayingFromTrackPlayer } from './widgetSync';

/**
 * RNTP playback service — registered in `index.js`. Runs in a headless context
 * and wires MediaSession / lock-screen / notification / Bluetooth remote
 * controls to the player. Must not depend on React or the JS UI tree.
 */
export async function PlaybackService(): Promise<void> {
  TrackPlayer.addEventListener(Event.PlaybackActiveTrackChanged, () => {
    void syncWidgetNowPlayingFromTrackPlayer();
  });
  TrackPlayer.addEventListener(Event.PlaybackState, () => {
    void syncWidgetNowPlayingFromTrackPlayer();
  });
  TrackPlayer.addEventListener(Event.RemotePlay, () => {
    void TrackPlayer.play().finally(() => syncWidgetNowPlayingFromTrackPlayer());
  });
  TrackPlayer.addEventListener(Event.RemotePause, () => {
    void TrackPlayer.pause().finally(() => syncWidgetNowPlayingFromTrackPlayer());
  });
  TrackPlayer.addEventListener(Event.RemoteStop, () => {
    void TrackPlayer.stop().finally(() => syncWidgetNowPlayingFromTrackPlayer());
  });
  TrackPlayer.addEventListener(Event.RemoteNext, () => {
    void TrackPlayer.skipToNext()
      .catch(() => {})
      .finally(() => syncWidgetNowPlayingFromTrackPlayer());
  });
  TrackPlayer.addEventListener(Event.RemotePrevious, () => {
    void TrackPlayer.skipToPrevious()
      .catch(() => {})
      .finally(() => syncWidgetNowPlayingFromTrackPlayer());
  });
  TrackPlayer.addEventListener(Event.RemoteSeek, ({ position }) =>
    TrackPlayer.seekTo(position),
  );
}

import TrackPlayer, { Event } from 'react-native-track-player';
import { syncCarNowPlayingFromTrackPlayer } from './carSync';
import { syncWidgetNowPlayingFromTrackPlayer } from './widgetSync';
import { applyNormalizationForActiveTrack } from './applyNormalization';
import { ensureGainRegistryStarted } from './gainRegistry';
import { ensureEQRouteSyncStarted } from './eqRouteSync';

/**
 * RNTP playback service — registered in `index.js`. Runs in a headless context
 * and wires MediaSession / lock-screen / notification / Bluetooth remote
 * controls to the player. Must not depend on React or the JS UI tree.
 */
export async function PlaybackService(): Promise<void> {
  // Whole-queue gain registration + fallback gain, headless-safe (Android Auto /
  // Bluetooth starts with the app UI never mounted must still normalize).
  ensureGainRegistryStarted();
  void ensureEQRouteSyncStarted().catch((error) => {
    console.warn('[eq-route] headless init failed', error);
  });

  const syncNowPlaying = () =>
    Promise.allSettled([
      syncWidgetNowPlayingFromTrackPlayer(),
      syncCarNowPlayingFromTrackPlayer(),
    ]);

  TrackPlayer.addEventListener(Event.PlaybackActiveTrackChanged, () => {
    void syncNowPlaying();
    // Apply normalization here too (not just in the UI hook) so playback started from
    // Android Auto / Bluetooth with the app closed is still normalized.
    void applyNormalizationForActiveTrack();
  });
  TrackPlayer.addEventListener(Event.PlaybackState, () => {
    void syncNowPlaying();
  });
  TrackPlayer.addEventListener(Event.RemotePlay, () => {
    void TrackPlayer.play().finally(() => syncNowPlaying());
  });
  TrackPlayer.addEventListener(Event.RemotePause, () => {
    void TrackPlayer.pause().finally(() => syncNowPlaying());
  });
  TrackPlayer.addEventListener(Event.RemoteStop, () => {
    void TrackPlayer.stop().finally(() => syncNowPlaying());
  });
  TrackPlayer.addEventListener(Event.RemoteNext, () => {
    void TrackPlayer.skipToNext()
      .catch(() => {})
      .finally(() => syncNowPlaying());
  });
  TrackPlayer.addEventListener(Event.RemotePrevious, () => {
    void TrackPlayer.skipToPrevious()
      .catch(() => {})
      .finally(() => syncNowPlaying());
  });
  TrackPlayer.addEventListener(Event.RemoteSeek, ({ position }) =>
    TrackPlayer.seekTo(position).finally(() => syncNowPlaying()),
  );
}

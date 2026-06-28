import { useEffect } from 'react';
import { AppState } from 'react-native';
import { usePlayerStore } from '@/stores/playerStore';
import {
  initLastFmService,
  publishLastFmSnapshot,
  requestLastFmFlush,
} from '@/services/lastfm';
import type { ScrobbleSnapshot } from '@/services/lastfm/scrobbleService';

/**
 * Feeds the Last.fm scrobble service from `playerStore`. The store's `currentTime`
 * is refreshed ~every 500ms by `usePlaybackSync` (useProgress), so this publishes a
 * snapshot on every progress tick / track change / state change — exactly the cadence
 * the desktop service's timing state machine expects. Mount once near the root.
 */
export function useLastFmScrobbler(): void {
  const currentTrack = usePlayerStore((s) => s.currentTrack);
  const currentTime = usePlayerStore((s) => s.currentTime);
  const duration = usePlayerStore((s) => s.duration);
  const playbackState = usePlayerStore((s) => s.playbackState);

  // Construct the service once (drains the offline queue on launch). Idempotent.
  useEffect(() => {
    void initLastFmService().catch((err) => {
      console.warn('[lastfm] service init failed', err);
    });
  }, []);

  useEffect(() => {
    const snapshot: ScrobbleSnapshot = {
      playbackState,
      currentTime,
      // Prefer the track's metadata duration — it's known the instant the track is
      // active, whereas RNTP's progress duration is 0 for the first moments of a
      // track. The scrobble threshold (half the duration) depends on this.
      duration: currentTrack && currentTrack.duration > 0 ? currentTrack.duration : duration,
      currentTrack: currentTrack
        ? {
            path: currentTrack.path ?? null,
            title: currentTrack.title,
            artist: currentTrack.artist,
            artistNames: currentTrack.artistNames,
            album: currentTrack.album ?? null,
          }
        : null,
    };
    publishLastFmSnapshot(snapshot);
  }, [currentTrack, currentTime, duration, playbackState]);

  // Returning to the foreground (or regaining connectivity) is the natural moment
  // to retry any queued offline scrobbles. NetInfo isn't a dependency; the service's
  // own retry timer covers the rest.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') requestLastFmFlush();
    });
    return () => sub.remove();
  }, []);
}

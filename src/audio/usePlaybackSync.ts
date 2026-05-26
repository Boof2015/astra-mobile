import { useEffect } from 'react';
import {
  State,
  useActiveTrack,
  usePlaybackState,
  useProgress,
} from 'react-native-track-player';
import { usePlayerStore } from '@/stores/playerStore';
import type { PlaybackState } from '@/types/audio';
import { rntpToTrack } from './sampleTracks';

function mapState(state?: State): PlaybackState {
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
      return 'stopped'; // None, Stopped, Ended, Error
  }
}

/**
 * Mirrors RNTP's playback state into `playerStore` so the whole UI reads from
 * one Zustand source (matching the desktop pattern). Mount once, near the root.
 */
export function usePlaybackSync(): void {
  const activeTrack = useActiveTrack();
  const progress = useProgress(500);
  const playbackState = usePlaybackState();

  const setCurrentTrack = usePlayerStore((s) => s.setCurrentTrack);
  const setProgress = usePlayerStore((s) => s.setProgress);
  const setPlaybackState = usePlayerStore((s) => s.setPlaybackState);

  useEffect(() => {
    setCurrentTrack(activeTrack ? rntpToTrack(activeTrack) : null);
  }, [activeTrack, setCurrentTrack]);

  useEffect(() => {
    setProgress(progress.position, progress.duration);
  }, [progress.position, progress.duration, setProgress]);

  useEffect(() => {
    setPlaybackState(mapState(playbackState.state));
  }, [playbackState.state, setPlaybackState]);
}

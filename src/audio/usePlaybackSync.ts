import { useEffect, useRef } from 'react';
import {
  State,
  useActiveTrack,
  usePlaybackState,
  useProgress,
} from 'react-native-track-player';
import { usePlayerStore } from '@/stores/playerStore';
import { useLibraryStore } from '@/stores/libraryStore';
import type { PlaybackState } from '@/types/audio';
import { rntpToTrack } from './sampleTracks';
import { buildWidgetRecentItems, setWidgetNowPlaying } from './widgetSync';

const RECENT_PLAY_THRESHOLD_MS = 15_000;

interface RecentPlayCandidate {
  path: string | null;
  accumulatedMs: number;
  playingSinceMs: number | null;
  recorded: boolean;
}

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
  const mappedPlaybackState = mapState(playbackState.state);
  const recentPlayCandidate = useRef<RecentPlayCandidate>({
    path: null,
    accumulatedMs: 0,
    playingSinceMs: null,
    recorded: false,
  });

  const setCurrentTrack = usePlayerStore((s) => s.setCurrentTrack);
  const setProgress = usePlayerStore((s) => s.setProgress);
  const setPlaybackState = usePlayerStore((s) => s.setPlaybackState);
  const recordTrackPlayed = useLibraryStore((s) => s.recordTrackPlayed);
  const recentlyPlayedTracks = useLibraryStore((s) => s.recentlyPlayedTracks);

  useEffect(() => {
    setCurrentTrack(activeTrack ? rntpToTrack(activeTrack) : null);
  }, [activeTrack, setCurrentTrack]);

  useEffect(() => {
    setProgress(progress.position, progress.duration);
  }, [progress.position, progress.duration, setProgress]);

  useEffect(() => {
    setPlaybackState(mappedPlaybackState);
  }, [mappedPlaybackState, setPlaybackState]);

  useEffect(() => {
    const track = activeTrack ? rntpToTrack(activeTrack) : null;
    setWidgetNowPlaying(
      track,
      mappedPlaybackState,
      buildWidgetRecentItems(recentlyPlayedTracks, track?.path),
    );
  }, [activeTrack, mappedPlaybackState, recentlyPlayedTracks]);

  useEffect(() => {
    const path = activeTrack?.url ? String(activeTrack.url) : null;
    const now = Date.now();
    const candidate = recentPlayCandidate.current;

    if (!path || mappedPlaybackState === 'stopped') {
      recentPlayCandidate.current = {
        path: null,
        accumulatedMs: 0,
        playingSinceMs: null,
        recorded: false,
      };
      return;
    }

    if (candidate.path !== path) {
      candidate.path = path;
      candidate.accumulatedMs = 0;
      candidate.playingSinceMs = null;
      candidate.recorded = false;
    }

    if (mappedPlaybackState !== 'playing') {
      if (candidate.playingSinceMs != null) {
        candidate.accumulatedMs += now - candidate.playingSinceMs;
        candidate.playingSinceMs = null;
      }
      return;
    }

    if (candidate.playingSinceMs == null) {
      candidate.playingSinceMs = now;
    }

    const elapsedMs = candidate.accumulatedMs + (now - candidate.playingSinceMs);
    if (candidate.recorded || elapsedMs < RECENT_PLAY_THRESHOLD_MS) return;

    candidate.recorded = true;
    void recordTrackPlayed(path).catch((err) => {
      console.warn('[library] playback history update failed', err);
    });
  }, [activeTrack?.url, mappedPlaybackState, progress.position, recordTrackPlayed]);
}

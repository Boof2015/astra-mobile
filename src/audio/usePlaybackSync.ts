import { useEffect, useRef } from 'react';
import {
  State,
  useActiveTrack,
  usePlaybackState,
  useProgress,
} from 'react-native-track-player';
import { usePlayerStore } from '@/stores/playerStore';
import { useLibraryStore } from '@/stores/libraryStore';
import type { PlaybackState, Track } from '@/types/audio';
import { rntpToTrack } from './sampleTracks';
import { buildWidgetRecentItems, setWidgetNowPlaying } from './widgetSync';

const RECENT_PLAY_THRESHOLD_MS = 15_000;
const SEEK_ACK_EPS = 0.75;
const SEEK_ACK_TIMEOUT_MS = 3000;

interface RecentPlayCandidate {
  path: string | null;
  accumulatedMs: number;
  playingSinceMs: number | null;
  recorded: boolean;
}

interface StablePlaybackState {
  path: string | null;
  state: PlaybackState;
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
 * Field-exact equality over everything `rntpToTrack` emits. Both the optimistic
 * controller write and the RNTP confirmation build tracks through it, so a
 * match means the confirmation carries nothing new.
 */
function sameTrack(a: Track | null, b: Track | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    a.id === b.id &&
    a.path === b.path &&
    a.title === b.title &&
    a.artist === b.artist &&
    a.album === b.album &&
    a.duration === b.duration &&
    a.artworkData === b.artworkData &&
    a.format === b.format &&
    a.sampleRate === b.sampleRate &&
    a.bitDepth === b.bitDepth &&
    a.bitrate === b.bitrate &&
    a.sourceType === b.sourceType &&
    a.sourceId === b.sourceId &&
    a.sourceTrackId === b.sourceTrackId &&
    a.artworkSourceId === b.artworkSourceId
  );
}

function resolveTransientLoading(
  rawState: PlaybackState,
  activeTrackPath: string | null,
  stable: StablePlaybackState
): PlaybackState {
  if (
    rawState === 'loading' &&
    activeTrackPath != null &&
    activeTrackPath === stable.path &&
    (stable.state === 'playing' || stable.state === 'paused')
  ) {
    return stable.state;
  }
  return rawState;
}

/**
 * Mirrors RNTP's playback state into `playerStore` so the whole UI reads from
 * one Zustand source (matching the desktop pattern). Mount once, near the root.
 */
export function usePlaybackSync(): void {
  const activeTrack = useActiveTrack();
  const progress = useProgress(500);
  const playbackState = usePlaybackState();
  const recentPlayCandidate = useRef<RecentPlayCandidate>({
    path: null,
    accumulatedMs: 0,
    playingSinceMs: null,
    recorded: false,
  });
  const stablePlayback = useRef<{ path: string | null; state: PlaybackState }>({
    path: null,
    state: 'stopped',
  });
  const rawPlaybackState = mapState(playbackState.state);

  const setCurrentTrack = usePlayerStore((s) => s.setCurrentTrack);
  const setProgress = usePlayerStore((s) => s.setProgress);
  const setPlaybackState = usePlayerStore((s) => s.setPlaybackState);
  const recordTrackPlayed = useLibraryStore((s) => s.recordTrackPlayed);
  const recentlyPlayedTracks = useLibraryStore((s) => s.recentlyPlayedTracks);

  useEffect(() => {
    const nextTrack = activeTrack ? rntpToTrack(activeTrack) : null;
    const prevTrack = usePlayerStore.getState().currentTrack;
    if (prevTrack?.path !== nextTrack?.path) {
      usePlayerStore.getState().clearPendingSeek();
    }
    // RNTP usually just confirms the optimistic track the controller already
    // wrote; skip the redundant store write (a full re-render wave of every
    // currentTrack subscriber) when nothing actually changed.
    if (sameTrack(prevTrack, nextTrack)) return;
    setCurrentTrack(nextTrack);
  }, [activeTrack, setCurrentTrack]);

  useEffect(() => {
    const pendingSeek = usePlayerStore.getState().pendingSeek;
    if (pendingSeek) {
      const acknowledged = Math.abs(progress.position - pendingSeek.target) <= SEEK_ACK_EPS;
      const timedOut = Date.now() - pendingSeek.startedAt > SEEK_ACK_TIMEOUT_MS;
      if (!acknowledged && !timedOut) return;
      usePlayerStore.getState().clearPendingSeek();
    }
    setProgress(progress.position, progress.duration);
  }, [progress.position, progress.duration, setProgress]);

  useEffect(() => {
    const activeTrackPath = activeTrack ? rntpToTrack(activeTrack).path : null;
    const mappedPlaybackState = resolveTransientLoading(
      rawPlaybackState,
      activeTrackPath,
      stablePlayback.current
    );
    if (
      mappedPlaybackState === 'loading' &&
      (stablePlayback.current.state === 'playing' || stablePlayback.current.state === 'paused')
    ) {
      // Cross-track loading (skip/advance): local transitions resolve almost
      // instantly, so surfacing 'loading' immediately just flaps the play icon
      // and re-renders every playbackState subscriber twice per skip. Hold the
      // previous state and only show the spinner if the load actually drags
      // (e.g. a slow remote stream). Cleanup cancels on the next state event.
      const timer = setTimeout(() => setPlaybackState('loading'), 250);
      return () => clearTimeout(timer);
    }
    setPlaybackState(mappedPlaybackState);
    if (mappedPlaybackState !== 'loading') {
      stablePlayback.current = {
        path: activeTrackPath,
        state: mappedPlaybackState,
      };
    }
  }, [activeTrack, rawPlaybackState, setPlaybackState]);

  // Push the widget now-playing (incl. the recents list) on track/state/recents change only
  // — NOT on every 500ms progress tick. The widget shows no position, so per-tick updates
  // were pure waste; with Android Auto connected the sibling car push fanned out to a full
  // MediaSession setMetadata + host IPC at 2 Hz, whose spikes janked the Skia scopes +
  // now-playing timeline. The car now-playing is owned by the headless PlaybackService,
  // which re-syncs it (with a fresh position) on RNTP track/state events — so it isn't
  // pushed from here at all (the MediaSession extrapolates position between those events).
  useEffect(() => {
    const track = activeTrack ? rntpToTrack(activeTrack) : null;
    const mappedPlaybackState = resolveTransientLoading(
      rawPlaybackState,
      track?.path ?? null,
      stablePlayback.current
    );
    setWidgetNowPlaying(
      track,
      mappedPlaybackState,
      buildWidgetRecentItems(recentlyPlayedTracks, track?.path),
    );
  }, [activeTrack, rawPlaybackState, recentlyPlayedTracks]);

  useEffect(() => {
    // Use the identity path (subsonic://|jellyfin:// for remote; the file URI for
    // local) so history matches `tracks.path` — activeTrack.url is the stream URL.
    const path = activeTrack ? rntpToTrack(activeTrack).path : null;
    const mappedPlaybackState = resolveTransientLoading(
      rawPlaybackState,
      path,
      stablePlayback.current
    );
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
  }, [activeTrack, rawPlaybackState, progress.position, recordTrackPlayed]);
}

import { create } from 'zustand';
import type { PlaybackState, Track } from '@/types/audio';

export type RepeatMode = 'none' | 'one' | 'all';

interface PendingSeek {
  target: number;
  startedAt: number;
}

/**
 * Player state — the UI's single source of truth, mirrored from the playback
 * engine (RNTP at M0) by `usePlaybackSync`. Field names match desktop
 * `playerStore` so queue/transport logic ports cleanly. Setters are called by
 * the sync layer and the playback controller, not directly by screens.
 */
interface PlayerStore {
  currentTrack: Track | null;
  playbackState: PlaybackState;
  currentTime: number;
  duration: number;
  pendingSeek: PendingSeek | null;
  volume: number; // 0–1
  isMuted: boolean;
  // Field names mirror desktop playerStore so queue/transport logic stays consistent.
  shuffle: boolean;
  repeat: RepeatMode;
  /** Restored JS queue exists but has not been loaded into RNTP yet. */
  restoredSessionPending: boolean;

  setCurrentTrack: (track: Track | null) => void;
  setPlaybackState: (state: PlaybackState) => void;
  setProgress: (currentTime: number, duration: number) => void;
  setPendingSeek: (target: number) => void;
  clearPendingSeek: () => void;
  setVolume: (volume: number) => void;
  setMuted: (isMuted: boolean) => void;
  setShuffle: (shuffle: boolean) => void;
  setRepeat: (repeat: RepeatMode) => void;
  setRestoredSessionPending: (pending: boolean) => void;
  reset: () => void;
}

/** Below this, a reported track length is treated as the one already known. */
const DURATION_EPSILON_S = 0.5;

export const usePlayerStore = create<PlayerStore>((set) => ({
  currentTrack: null,
  playbackState: 'stopped',
  currentTime: 0,
  duration: 0,
  pendingSeek: null,
  volume: 1,
  isMuted: false,
  shuffle: false,
  repeat: 'none',
  restoredSessionPending: false,

  setCurrentTrack: (currentTrack) => set({ currentTrack }),
  setPlaybackState: (playbackState) => set({ playbackState }),
  // Native progress reports 0 while a track loads and then refines a known
  // length by fractions of a second. Each distinct value re-renders every
  // duration reader (waveform, lyric peek, scrobbler, mini player) — 3-4 extra
  // passes per skip in the trace (2026-10-02) — for no visible change.
  setProgress: (currentTime, duration) =>
    set((state) =>
      (duration <= 0 && state.duration > 0) ||
      Math.abs(duration - state.duration) < DURATION_EPSILON_S
        ? { currentTime }
        : { currentTime, duration }
    ),
  setPendingSeek: (target) => set({ pendingSeek: { target, startedAt: Date.now() } }),
  clearPendingSeek: () => set({ pendingSeek: null }),
  setVolume: (volume) => set({ volume }),
  setMuted: (isMuted) => set({ isMuted }),
  setShuffle: (shuffle) => set({ shuffle }),
  setRepeat: (repeat) => set({ repeat }),
  setRestoredSessionPending: (restoredSessionPending) => set({ restoredSessionPending }),
  reset: () =>
    set({
      currentTrack: null,
      playbackState: 'stopped',
      currentTime: 0,
      duration: 0,
      pendingSeek: null,
      restoredSessionPending: false,
    }),
}));

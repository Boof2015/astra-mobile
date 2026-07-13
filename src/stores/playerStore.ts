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
  setProgress: (currentTime, duration) => set({ currentTime, duration }),
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

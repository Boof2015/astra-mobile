import { create } from 'zustand';
import type { PlaybackState, Track } from '@/types/audio';

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
  volume: number; // 0–1
  isMuted: boolean;

  setCurrentTrack: (track: Track | null) => void;
  setPlaybackState: (state: PlaybackState) => void;
  setProgress: (currentTime: number, duration: number) => void;
  setVolume: (volume: number) => void;
  setMuted: (isMuted: boolean) => void;
  reset: () => void;
}

export const usePlayerStore = create<PlayerStore>((set) => ({
  currentTrack: null,
  playbackState: 'stopped',
  currentTime: 0,
  duration: 0,
  volume: 1,
  isMuted: false,

  setCurrentTrack: (currentTrack) => set({ currentTrack }),
  setPlaybackState: (playbackState) => set({ playbackState }),
  setProgress: (currentTime, duration) => set({ currentTime, duration }),
  setVolume: (volume) => set({ volume }),
  setMuted: (isMuted) => set({ isMuted }),
  reset: () =>
    set({ currentTrack: null, playbackState: 'stopped', currentTime: 0, duration: 0 }),
}));

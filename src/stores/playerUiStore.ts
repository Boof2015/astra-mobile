import { create } from 'zustand';

/**
 * Now-playing overlay gate. The player is an always-mounted overlay above the
 * navigator (not a route): `everOpened` latches the first mount so cold start
 * pays nothing, `playerOpen` drives the UI-thread slide open/close. Session
 * state only — never persisted.
 */
interface PlayerUiStore {
  playerOpen: boolean;
  /** Mount latch: once true the overlay stays mounted (hidden) for instant reopen. */
  everOpened: boolean;
  openPlayer: () => void;
  closePlayer: () => void;
  /** Mount the overlay hidden (e.g. shortly after playback starts) so even the first open is instant. */
  prewarm: () => void;
}

export const usePlayerUiStore = create<PlayerUiStore>((set) => ({
  playerOpen: false,
  everOpened: false,
  openPlayer: () => set({ playerOpen: true, everOpened: true }),
  closePlayer: () => set({ playerOpen: false }),
  prewarm: () => set({ everOpened: true }),
}));

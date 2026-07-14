import { create } from 'zustand';

/**
 * Now-playing overlay gate. The player is an overlay above the navigator (not
 * a route); its host retains it only long enough to finish the close animation.
 * Session state only — never persisted.
 */
interface PlayerUiStore {
  playerOpen: boolean;
  openPlayer: () => void;
  closePlayer: () => void;
}

export const usePlayerUiStore = create<PlayerUiStore>((set) => ({
  playerOpen: false,
  openPlayer: () => set({ playerOpen: true }),
  closePlayer: () => set({ playerOpen: false }),
}));

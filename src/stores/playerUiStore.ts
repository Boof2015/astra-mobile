import { create } from 'zustand';
import {
  commitPlayerClosed,
  initialPlayerPresence,
  isPlayerMounted,
  isPlayerOnScreen,
  requestPlayerClose,
  requestPlayerOpen,
  settlePlayerOpen,
  type PlayerPresenceState,
} from '@/stores/playerPresence';

/**
 * Now-playing overlay gate. The player is an overlay above the navigator (not a
 * route), and this phase is the only thing that decides whether it is mounted
 * and on screen. See `playerPresence.ts` for the invariants. Session state only
 * — never persisted.
 */
interface PlayerUiStore extends PlayerPresenceState {
  openPlayer: () => void;
  /**
   * @param exitAnimated pass true when the caller is already animating the sheet
   * away, so the overlay does not start a competing slide-out.
   */
  closePlayer: (exitAnimated?: boolean) => void;
  commitClosed: () => void;
  settleOpen: () => void;
}

export const usePlayerUiStore = create<PlayerUiStore>((set) => ({
  ...initialPlayerPresence,
  openPlayer: () => set(requestPlayerOpen),
  closePlayer: (exitAnimated = false) =>
    set((state) => requestPlayerClose(state, exitAnimated)),
  commitClosed: () => set(commitPlayerClosed),
  settleOpen: () => set(settlePlayerOpen),
}));

/** Whether the overlay tree should be rendered at all. */
export function usePlayerMounted(): boolean {
  return usePlayerUiStore((s) => isPlayerMounted(s.phase));
}

/** Whether the sheet should be resting on screen rather than sliding away. */
export function usePlayerOnScreen(): boolean {
  return usePlayerUiStore((s) => isPlayerOnScreen(s.phase));
}

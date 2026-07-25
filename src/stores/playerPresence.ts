/**
 * Now-playing presentation phases.
 *
 * The player is an overlay above the navigator, not a route, so nothing but this
 * phase decides whether it is on screen. It used to be a bare `playerOpen`
 * boolean paired with a separate mount gate and a Reanimated offset, and those
 * three could disagree: a cancelled close animation left the flag `true` with
 * the sheet parked off-screen, and because reopening was `set({ open: true })`
 * it produced no state change and therefore no re-render — the player could
 * never be reopened again for the rest of the session.
 *
 * Two invariants keep that from coming back:
 *  - every open request bumps `openRequest`, so a repeat request is always a
 *    real state change and always re-runs the enter animation (the repair path);
 *  - phase transitions never depend on an animation completing. `closing` is
 *    entered before the exit animation starts, and `closed` is committed by
 *    whichever lands first, the animation callback or a fallback timer.
 */
export type PlayerPhase = 'closed' | 'opening' | 'open' | 'closing';

export interface PlayerPresenceState {
  phase: PlayerPhase;
  openRequest: number;
  /**
   * Whether the current close already has an exit animation attached. The
   * gesture and button paths drive the sheet themselves (with velocity-matched
   * spring shaping), so the overlay must not start a competing one; a close
   * requested from anywhere else gets a plain slide-out instead.
   */
  exitAnimated: boolean;
}

export const initialPlayerPresence: PlayerPresenceState = {
  phase: 'closed',
  openRequest: 0,
  exitAnimated: false,
};

/**
 * Ask for the player. Unconditional on purpose: requesting an open while the
 * phase already says `open` still bumps `openRequest`, which is what lets a tap
 * recover a sheet that was stranded off-screen by an interrupted close.
 */
export function requestPlayerOpen(state: PlayerPresenceState): PlayerPresenceState {
  return { phase: 'opening', openRequest: state.openRequest + 1, exitAnimated: false };
}

/** Begin the exit. Safe to call repeatedly; a closed player stays closed. */
export function requestPlayerClose(
  state: PlayerPresenceState,
  exitAnimated = false
): PlayerPresenceState {
  if (state.phase === 'closed') return state;
  return { ...state, phase: 'closing', exitAnimated };
}

/**
 * Release the overlay. Ignored unless still closing, so a fallback timer that
 * fires after the user reopened the player cannot yank it back off screen.
 */
export function commitPlayerClosed(state: PlayerPresenceState): PlayerPresenceState {
  if (state.phase !== 'closing') return state;
  return { ...state, phase: 'closed' };
}

/** Settle the enter animation. Cosmetic only — nothing gates on it. */
export function settlePlayerOpen(state: PlayerPresenceState): PlayerPresenceState {
  if (state.phase !== 'opening') return state;
  return { ...state, phase: 'open' };
}

/** Whether the heavyweight overlay tree should be mounted. */
export function isPlayerMounted(phase: PlayerPhase): boolean {
  return phase !== 'closed';
}

/** Whether the sheet should be resting on screen (as opposed to sliding away). */
export function isPlayerOnScreen(phase: PlayerPhase): boolean {
  return phase === 'opening' || phase === 'open';
}

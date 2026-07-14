import { useEffect, useReducer } from 'react';

export type DelayedPresenceEvent = 'show' | 'hide' | 'drop';

/**
 * Tiny state machine shared by heavyweight render surfaces. `hide` is emitted
 * only after the caller's linger timer, while `drop` releases the surface
 * immediately (for example when Android backgrounds the activity).
 */
export function delayedPresenceReducer(
  retained: boolean,
  event: DelayedPresenceEvent
): boolean {
  if (event === 'show') return true;
  if (event === 'hide' || event === 'drop') return false;
  return retained;
}

export function scheduleDelayedPresenceHide(delayMs: number, onHide: () => void) {
  const timer = setTimeout(onHide, delayMs);
  return () => clearTimeout(timer);
}

/**
 * Keep a subtree mounted briefly after `active` turns false so its exit
 * animation can finish, then release it. Re-activation cancels the pending
 * release. `drop` bypasses the delay for background/low-visibility teardown.
 */
export function useDelayedUnmountPresence(
  active: boolean,
  delayMs: number,
  drop = false
): boolean {
  const [retained, dispatch] = useReducer(delayedPresenceReducer, active && !drop);

  useEffect(() => {
    if (drop) {
      dispatch('drop');
      return undefined;
    }
    if (active) {
      dispatch('show');
      return undefined;
    }
    if (!retained) return undefined;

    return scheduleDelayedPresenceHide(delayMs, () => dispatch('hide'));
  }, [active, delayMs, drop, retained]);

  return !drop && (active || retained);
}

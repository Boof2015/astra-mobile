import { useEffect, useState } from 'react';
import { AppState, type AppStateStatus } from 'react-native';

export function isForegroundAppState(state: AppStateStatus | null): boolean {
  return state === 'active';
}

/**
 * Seed value for the hook. `AppState.currentState` can still be null/unknown
 * while the activity is coming up, and the `change` listener only fires on a
 * transition — so trusting a null seed leaves consumers stuck in the background
 * branch for the whole session. A mounting React tree means the UI is up, so an
 * unknown initial state is treated as foreground.
 */
export function initialForegroundAppState(state: AppStateStatus | null): boolean {
  return state == null || state === 'unknown' ? true : isForegroundAppState(state);
}

/**
 * Explicit foreground signal for render loops and native-backed surfaces.
 * React Native normally suspends animation frames in the background, but
 * unmounting these surfaces also releases their TextureViews and GPU backing.
 */
export function useAppForeground(): boolean {
  const [foreground, setForeground] = useState(() =>
    initialForegroundAppState(AppState.currentState)
  );

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      setForeground(isForegroundAppState(state));
    });
    return () => subscription.remove();
  }, []);

  return foreground;
}

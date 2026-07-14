import { useEffect, useState } from 'react';
import { AppState, type AppStateStatus } from 'react-native';

export function isForegroundAppState(state: AppStateStatus | null): boolean {
  return state === 'active';
}

/**
 * Explicit foreground signal for render loops and native-backed surfaces.
 * React Native normally suspends animation frames in the background, but
 * unmounting these surfaces also releases their TextureViews and GPU backing.
 */
export function useAppForeground(): boolean {
  const [foreground, setForeground] = useState(() =>
    isForegroundAppState(AppState.currentState)
  );

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      setForeground(isForegroundAppState(state));
    });
    return () => subscription.remove();
  }, []);

  return foreground;
}

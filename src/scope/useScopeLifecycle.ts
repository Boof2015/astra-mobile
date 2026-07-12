import { useEffect } from 'react';
import { AccessibilityInfo, AppState } from 'react-native';
import { AstraScope } from '../../modules/astra-scope';
import { usePlayerStore } from '@/stores/playerStore';
import { useScopeStore } from './scopeStore';

/**
 * Single owner of the scope on/off gate. Visualizers run only when the app is
 * foregrounded, audio is playing, and reduced-motion is off — which also stops
 * the native PCM tap (AstraScope.setActive) so a backgrounded/paused app pays
 * ~nothing in the audio callback. Mount once near the root.
 */
export function useScopeLifecycle(): void {
  useEffect(() => {
    let reduceMotion = false;
    let appActive = AppState.currentState === 'active';
    // recompute runs on every playerStore change (incl. 2Hz progress writes);
    // only touch the native tap + store when the gate actually flips.
    let lastOn: boolean | null = null;

    const recompute = () => {
      const playing = usePlayerStore.getState().playbackState === 'playing';
      const on = playing && appActive && !reduceMotion;
      if (on === lastOn) return;
      lastOn = on;
      AstraScope.setActive(on);
      useScopeStore.getState().setActive(on);
    };

    const appSub = AppState.addEventListener('change', (state) => {
      appActive = state === 'active';
      recompute();
    });
    const rmSub = AccessibilityInfo.addEventListener('reduceMotionChanged', (enabled) => {
      reduceMotion = enabled;
      recompute();
    });
    const unsubPlayer = usePlayerStore.subscribe(recompute);
    void AccessibilityInfo.isReduceMotionEnabled().then((enabled) => {
      reduceMotion = enabled;
      recompute();
    });
    recompute();

    return () => {
      appSub.remove();
      rmSub.remove();
      unsubPlayer();
      AstraScope.setActive(false);
      useScopeStore.getState().setActive(false);
    };
  }, []);
}

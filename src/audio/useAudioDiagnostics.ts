import { useCallback, useState } from 'react';
import { AppState } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { AstraAudioRoute } from '../../modules/astra-audio-route';
import type { AudioDiagnosticsSnapshot } from './audioDiagnostics';

export function useAudioDiagnostics(enabled: boolean): AudioDiagnosticsSnapshot | null {
  const [snapshot, setSnapshot] = useState<AudioDiagnosticsSnapshot | null>(null);
  useFocusEffect(useCallback(() => {
    if (!enabled) return;
    let timer: ReturnType<typeof setInterval> | null = null;
    const refresh = () => {
      try {
        setSnapshot(AstraAudioRoute.getAudioDiagnostics());
      } catch {
        // Old native builds and transient route errors get an honest unavailable state.
        setSnapshot(null);
      }
    };
    const stop = () => {
      if (timer !== null) clearInterval(timer);
      timer = null;
    };
    const update = (state: string | null) => {
      stop();
      if (state != null && state !== 'active' && state !== 'unknown') return;
      refresh();
      timer = setInterval(refresh, 1000);
    };
    update(AppState.currentState);
    const subscription = AppState.addEventListener('change', update);
    return () => { stop(); subscription.remove(); };
  }, [enabled]));
  return enabled ? snapshot : null;
}

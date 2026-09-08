import { AstraCar } from '../../modules/astra-car';
import { usePlayerStore } from '@/stores/playerStore';
import { useQueueStore } from '@/stores/queueStore';

// Native playback owns track metadata and the clock. Only Astra's logical modes
// (virtual repeat-all is not RNTP RepeatMode.Queue) cross this small JS bridge.
let installed = false;
export function initializeCarContextSync(): void {
  if (installed) return;
  installed = true;
  const sync = () => {
    const player = usePlayerStore.getState();
    AstraCar.setPlaybackContext({
      shuffle: player.shuffle,
      repeat: player.repeat,
      sessionId: useQueueStore.getState().transport?.sessionId ?? null,
    });
  };
  usePlayerStore.subscribe((state, previous) => {
    if (state.shuffle !== previous.shuffle || state.repeat !== previous.repeat) sync();
  });
  useQueueStore.subscribe((state, previous) => {
    if (state.transport?.sessionId !== previous.transport?.sessionId) sync();
  });
  sync();
}

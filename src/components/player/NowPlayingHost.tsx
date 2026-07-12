import { useEffect } from 'react';
import { NowPlayingOverlay } from '@/components/player/NowPlayingOverlay';
import { usePlayerUiStore } from '@/stores/playerUiStore';
import { usePlayerStore } from '@/stores/playerStore';

const PREWARM_DELAY_MS = 2000;

/**
 * Mount gate for the always-mounted now-playing overlay. Nothing mounts until a
 * track exists (cold start unchanged); shortly after playback first starts the
 * overlay pre-warms hidden so even the FIRST open is a pure slide, no mount cost.
 */
export function NowPlayingHost() {
  const everOpened = usePlayerUiStore((s) => s.everOpened);
  const hasTrack = usePlayerStore((s) => Boolean(s.currentTrack));

  useEffect(() => {
    if (everOpened || !hasTrack) return;
    const timer = setTimeout(() => usePlayerUiStore.getState().prewarm(), PREWARM_DELAY_MS);
    return () => clearTimeout(timer);
  }, [everOpened, hasTrack]);

  if (!everOpened) return null;
  return <NowPlayingOverlay />;
}

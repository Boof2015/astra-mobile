import { NowPlayingOverlay } from '@/components/player/NowPlayingOverlay';
import { useDelayedUnmountPresence } from '@/components/delayedPresence';
import { NOW_PLAYING_CLOSE_UNMOUNT_MS } from '@/components/renderPresenceTiming';
import { useAppForeground } from '@/lib/useAppForeground';
import { usePlayerUiStore } from '@/stores/playerUiStore';

/**
 * Presence gate for the heavyweight now-playing tree. It stays alive just past
 * the 200 ms close animation, but never remains hidden indefinitely. Android
 * backgrounding drops it immediately so TextureViews and decoded art release.
 */
export function NowPlayingHost() {
  const playerOpen = usePlayerUiStore((s) => s.playerOpen);
  const foreground = useAppForeground();

  const renderOverlay = useDelayedUnmountPresence(
    playerOpen,
    NOW_PLAYING_CLOSE_UNMOUNT_MS,
    !foreground
  );

  if (!renderOverlay) return null;
  return <NowPlayingOverlay />;
}

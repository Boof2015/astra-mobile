import { useDesktopRemoteStore } from '@/stores/desktopRemoteStore';
import { usePlaybackTargetStore } from '@/stores/playbackTargetStore';
import { usePlayerStore } from '@/stores/playerStore';
import { effectiveMiniPlayerVisible } from '@/playback/playbackTargetPresentation';

/** Mirrors the visibility choice made by MiniPlayer without subscribing to progress. */
export function useMiniPlayerVisible(): boolean {
  const selectedTarget = usePlaybackTargetStore((state) => state.target);
  const phoneHasTrack = usePlayerStore((state) => state.currentTrack != null);
  const desktopConnected = useDesktopRemoteStore((state) => state.connection != null);
  const desktopHasTrack = useDesktopRemoteStore(
    (state) => state.snapshot?.currentTrack != null
  );
  return effectiveMiniPlayerVisible({
    selectedTarget,
    phoneHasTrack,
    desktopConnected,
    desktopHasTrack,
  });
}

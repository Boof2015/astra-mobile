import { NowPlayingOverlay } from '@/components/player/NowPlayingOverlay';
import { usePlayerMounted } from '@/stores/playerUiStore';

/**
 * Presence gate for the heavyweight now-playing tree. The store's `closing`
 * phase is the linger that lets the exit animation finish, so this is a plain
 * mirror of the phase — no second timer and no foreground gate.
 *
 * Backgrounding deliberately does NOT unmount here any more. Dropping the whole
 * tree tore down the shared value mid-close, which stranded the phase and made
 * the player permanently unopenable. The overlay releases its own TextureViews
 * and decoded art instead, by folding `useAppForeground` into the `active` /
 * `paused` props of the scope surfaces (the same thing MiniPlayer does).
 */
export function NowPlayingHost() {
  const mounted = usePlayerMounted();

  if (!mounted) return null;
  return <NowPlayingOverlay />;
}

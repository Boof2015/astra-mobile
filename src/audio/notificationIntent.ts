import TrackPlayer from 'react-native-track-player';
import { usePlayerStore } from '@/stores/playerStore';
import { usePlayerUiStore } from '@/stores/playerUiStore';

const NOTIFICATION_CLICK_TARGETS = new Set([
  'trackplayer://notification.click',
  'astra://notification.click',
  'astra:///notification.click',
  '/notification.click',
  'notification.click',
]);

export function isNotificationClickPath(path: string): boolean {
  const cleanPath = path.trim();
  const pathWithoutSuffix = cleanPath.split(/[?#]/, 1)[0];

  if (
    NOTIFICATION_CLICK_TARGETS.has(cleanPath) ||
    NOTIFICATION_CLICK_TARGETS.has(pathWithoutSuffix) ||
    pathWithoutSuffix.replace(/^\/+/, '') === 'notification.click'
  ) {
    return true;
  }

  try {
    const url = new URL(cleanPath);
    return url.hostname === 'notification.click' || url.pathname === '/notification.click';
  } catch {
    return false;
  }
}

/**
 * Notification/widget tap: land on the tabs and, when a track is loaded, open
 * the now-playing overlay above them (the player is a store-gated overlay, not
 * a route). Returns the route to navigate to.
 */
export async function resolveNotificationClick(): Promise<'/'> {
  if (await hasLoadedTrack()) usePlayerUiStore.getState().openPlayer();
  return '/';
}

async function hasLoadedTrack(): Promise<boolean> {
  try {
    if (await TrackPlayer.getActiveTrack()) return true;
  } catch {
    // RNTP may not be initialized if an unexpected notification click arrives.
  }

  return Boolean(usePlayerStore.getState().currentTrack);
}

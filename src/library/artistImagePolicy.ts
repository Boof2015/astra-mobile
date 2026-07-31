import type { NetworkState, NetworkStateType } from 'expo-network';
import type {
  ArtistImageAutoPolicy,
  ArtistImageLookupTarget,
} from '../types/artistImages.ts';
import { normalizeArtistImageMatchName } from '../services/artistImages/deezer.ts';

export function canAutomaticallyDownloadArtistImages(
  policy: ArtistImageAutoPolicy,
  disclosureSeen: boolean,
  network: Pick<NetworkState, 'isConnected' | 'isInternetReachable' | 'type'>
): boolean {
  if (!disclosureSeen || policy === 'off') return false;
  if (!network.isConnected || network.isInternetReachable === false) return false;
  if (policy === 'any') return true;
  return (
    network.type === ('WIFI' as NetworkStateType) ||
    network.type === ('ETHERNET' as NetworkStateType)
  );
}

export function groupArtistImageTargetsByName<T extends ArtistImageLookupTarget>(
  targets: T[]
): T[][] {
  const groups = new Map<string, T[]>();
  for (const target of targets) {
    const key = normalizeArtistImageMatchName(target.artistName);
    if (!key) continue;
    const group = groups.get(key);
    if (group) group.push(target);
    else groups.set(key, [target]);
  }
  return [...groups.values()];
}

export function artistImageRetryBackoff(
  baseMs: number,
  retryCounts: number[],
  maximumMs = 24 * 60 * 60 * 1000
): number {
  const retryCount = Math.max(0, ...retryCounts);
  return Math.min(baseMs * 2 ** Math.min(retryCount, 5), maximumMs);
}

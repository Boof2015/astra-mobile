// In-memory registry of resolved remote-source configs (incl. the decrypted password
// and cached Jellyfin token), keyed by remote_sources.id. Populated by the remote
// sources store on init / create / update; read synchronously by remoteUrls.ts so the
// library UI and playback can build stream/cover URLs without an async hop.
//
// This is a plain module Map (not zustand) on purpose — secrets never enter store
// state / devtools, and lookups are synchronous.

import type { RemoteSourceType } from '@/types/remote';

export interface ResolvedRemoteConfig {
  id: number;
  type: RemoteSourceType;
  baseUrl: string;
  username: string;
  password: string;
  /** Jellyfin only. */
  accessToken?: string;
  userId?: string;
}

const registry = new Map<number, ResolvedRemoteConfig>();

export function setResolvedRemoteConfig(config: ResolvedRemoteConfig): void {
  registry.set(config.id, config);
}

export function getResolvedRemoteConfig(id: number): ResolvedRemoteConfig | undefined {
  return registry.get(id);
}

export function updateResolvedRemoteAuth(
  id: number,
  auth: { accessToken: string; userId: string }
): void {
  const existing = registry.get(id);
  if (existing) {
    existing.accessToken = auth.accessToken;
    existing.userId = auth.userId;
  }
}

export function clearResolvedRemoteConfig(id: number): void {
  registry.delete(id);
}

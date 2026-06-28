// Synchronous stream/cover URL resolution for remote tracks. Reads the decrypted
// config from the in-memory registry (remoteConfig) and delegates to the client URL
// builders. Returns null when the source isn't loaded yet (e.g. Jellyfin not
// authenticated) — callers fall back to no-art / the identity path.
//
// Audiophile default: original-quality streams (no Subsonic maxBitRate, Jellyfin
// Download endpoint rather than transcode).

import type { Track } from '@/types/audio';
import type { RemoteConnectionConfig } from '@/types/remote';
import { getResolvedRemoteConfig, type ResolvedRemoteConfig } from './remoteConfig';
import { buildSubsonicCoverArtUrl, buildSubsonicStreamUrl } from './subsonic';
import { buildJellyfinCoverArtUrl, buildJellyfinStreamUrl } from './jellyfin';

function connection(cfg: ResolvedRemoteConfig): RemoteConnectionConfig {
  return { baseUrl: cfg.baseUrl, username: cfg.username, password: cfg.password };
}

/** Build the playable HTTP stream URL for a remote track, or null if unavailable. */
export function streamUrlForTrack(track: Track): string | null {
  if (!track.sourceType || track.sourceType === 'local') return null;
  if (track.sourceId == null || !track.sourceTrackId) return null;
  const cfg = getResolvedRemoteConfig(track.sourceId);
  if (!cfg) return null;

  if (cfg.type === 'subsonic') {
    return buildSubsonicStreamUrl(connection(cfg), track.sourceTrackId);
  }
  if (cfg.type === 'jellyfin') {
    if (!cfg.accessToken) return null;
    return buildJellyfinStreamUrl(connection(cfg), track.sourceTrackId, cfg.accessToken);
  }
  return null;
}

/** Build the cover-art URL for a remote track, or null if unavailable. */
export function artworkUrlForTrack(
  track: Pick<Track, 'sourceType' | 'sourceId' | 'artworkSourceId'>
): string | null {
  if (!track.sourceType || track.sourceType === 'local') return null;
  if (track.sourceId == null || !track.artworkSourceId) return null;
  const cfg = getResolvedRemoteConfig(track.sourceId);
  if (!cfg) return null;

  if (cfg.type === 'subsonic') {
    return buildSubsonicCoverArtUrl(connection(cfg), track.artworkSourceId);
  }
  if (cfg.type === 'jellyfin') {
    if (!cfg.accessToken) return null;
    return buildJellyfinCoverArtUrl(connection(cfg), track.artworkSourceId, cfg.accessToken);
  }
  return null;
}

import type { Track } from '../types/audio.ts';
import type { ResolvedRemoteConfig } from '../services/remoteConfig.ts';

type ArtworkTrack = Pick<Track, 'sourceType' | 'sourceId' | 'artworkSourceId'>;
type Options = { size?: number };
type SourceCache = { auth: string; urls: Map<string, string> };

/** Subsonic generates a fresh salt per URL. Retain the URL for the identity of
 * the cover so focus/playback rerenders don't reset expo-image or re-extract
 * atmosphere colors. Connection/auth changes must still resolve a new URL.
 * This cache is TV-only, memory-only, bounded per live connection, and never
 * retains removed connection objects through a strong reference.
 */
export function createTvArtworkResolver(
  getConfig: (id: number) => ResolvedRemoteConfig | undefined,
  build: (track: ArtworkTrack, options: Options) => string | null,
  maxEntries = 512,
) {
  const sources = new WeakMap<ResolvedRemoteConfig, SourceCache>();
  return (track: ArtworkTrack, options: Options = {}): string | null => {
    if (!track.sourceType || track.sourceType === 'local' || track.sourceId == null || !track.artworkSourceId) return null;
    const config = getConfig(track.sourceId);
    if (!config) return null;
    // Jellyfin refreshes auth in place. Keep this snapshot private; never use
    // credentials as an image key, log field, or persisted cache identifier.
    const auth = JSON.stringify([config.type, config.baseUrl, config.username, config.password, config.accessToken, config.userId]);
    let source = sources.get(config);
    if (!source || source.auth !== auth) {
      source = { auth, urls: new Map() };
      sources.set(config, source);
    }
    const key = JSON.stringify([track.artworkSourceId, options.size]);
    const cached = source.urls.get(key);
    if (cached) {
      source.urls.delete(key);
      source.urls.set(key, cached);
      return cached;
    }
    const url = build(track, options);
    if (url) {
      source.urls.set(key, url);
      if (source.urls.size > maxEntries) source.urls.delete(source.urls.keys().next().value!);
    }
    return url;
  };
}

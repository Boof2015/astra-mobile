import {
  albumArtworkSource as localAlbumSource,
  trackArtworkThumbSource as localTrackSource,
  playerBackdropArtworkSource as localBackdropSource,
  artworkThumbFromSource,
} from '@/library/artwork';
import { getResolvedRemoteConfig } from '@/services/remoteConfig';
import { artworkUrlForTrack } from '@/services/remoteUrls';
import { createTvArtworkResolver } from './artworkUrlCache';

export { artworkUri, artworkThumbFromSource } from '@/library/artwork';

const remoteArtwork = createTvArtworkResolver(getResolvedRemoteConfig, artworkUrlForTrack);

export function albumArtworkSource(album: Parameters<typeof localAlbumSource>[0]): string | null {
  if (!album.source_type || album.source_type === 'local') return localAlbumSource(album);
  return remoteArtwork({ sourceType: album.source_type, sourceId: album.source_id ?? undefined, artworkSourceId: album.artwork_source_id ?? undefined });
}

export function trackArtworkThumbSource(track: Parameters<typeof localTrackSource>[0]): string | null {
  if (track.source_type === 'local') return localTrackSource(track);
  return remoteArtwork({ sourceType: track.source_type, sourceId: track.source_id ?? undefined, artworkSourceId: track.artwork_source_id ?? undefined });
}

export function playerBackdropArtworkSource(track: Parameters<typeof localBackdropSource>[0]): string | null {
  if (!track?.sourceType || track.sourceType === 'local') return localBackdropSource(track);
  return remoteArtwork(track, { size: 256 }) ?? artworkThumbFromSource(track.artworkData);
}

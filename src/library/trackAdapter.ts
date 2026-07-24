// Adapter between native repository rows and the player model.

import type { Track } from '@/types/audio';
import type { DbTrack } from '@/types/library';
import { artworkUri } from './artwork';
import { artworkUrlForTrack } from '@/services/remoteUrls';

export function dbTrackToTrack(track: DbTrack): Track {
  const isRemote = track.source_type !== 'local';
  // Local artwork is a cached file (artworkUri); remote artwork is a server URL
  // resolved on the fly from the source config + the stored cover-art id.
  const artworkData = isRemote
    ? (artworkUrlForTrack({
        sourceType: track.source_type,
        sourceId: track.source_id ?? undefined,
        artworkSourceId: track.artwork_source_id ?? undefined,
      }) ?? undefined)
    : track.artwork_hash
      ? artworkUri(track.artwork_hash)
      : undefined;

  return {
    id: String(track.id),
    path: track.path,
    origin: 'library',
    title: track.title,
    artist: track.artist,
    album: track.album,
    albumArtist: track.album_artist ?? undefined,
    albumIdentityKey: track.album_identity_key,
    duration: track.duration,
    trackNumber: track.track_number ?? undefined,
    discNumber: track.disc_number ?? undefined,
    year: track.year ?? undefined,
    genre: track.genre ?? undefined,
    artworkData,
    artworkHash: track.artwork_hash ?? undefined,
    format: track.format,
    sampleRate: track.sample_rate ?? undefined,
    bitDepth: track.bit_depth ?? undefined,
    bitrate: track.bitrate ?? undefined,
    channels: track.channels ?? undefined,
    codec: track.codec ?? undefined,
    sourceType: track.source_type,
    sourceId: track.source_id ?? undefined,
    sourceTrackId: track.source_track_id ?? undefined,
    sourcePath: track.source_path ?? undefined,
    artworkSourceId: track.artwork_source_id ?? undefined,
  };
}

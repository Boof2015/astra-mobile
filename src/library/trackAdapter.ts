// Adapters between the native scanner output, the SQLite row shape, and the
// app-level Track model the player consumes.

import type { Track } from '@/types/audio';
import type { DbTrack } from '@/types/library';
import type { TrackUpsert } from '@/db/queries';
import type { ExtractedMetadata, ScannedFile } from '../../modules/astra-library-scanner';
import { artworkUri } from './artwork';

const UNKNOWN_ARTIST = 'Unknown Artist';
const UNKNOWN_ALBUM = 'Unknown Album';

// Ports desktop normalizeDisplay/normalizeKey (library.ts:1023).
function normalizeKey(value: string): string {
  return value.replace(/\s+/g, ' ').trim().toLocaleLowerCase();
}

// M1-simple album identity: normalized "<album artist or artist>|<album>".
// Stored per track so getAlbums is a plain GROUP BY; the desktop compilation
// heuristic can land later by recomputing this column.
export function buildAlbumIdentityKey(
  albumArtist: string | null,
  artist: string,
  album: string
): string {
  const artistKey = normalizeKey(albumArtist || artist) || 'unknown artist';
  const albumKey = normalizeKey(album) || 'unknown album';
  return `${artistKey}|${albumKey}`;
}

const CODEC_BY_MIME: Record<string, string> = {
  'audio/flac': 'flac',
  'audio/mpeg': 'mp3',
  'audio/mpeg-l2': 'mp2',
  'audio/mp4a-latm': 'aac',
  'audio/aac': 'aac',
  'audio/alac': 'alac',
  'audio/opus': 'opus',
  'audio/vorbis': 'vorbis',
  'audio/raw': 'pcm',
  'audio/ac3': 'ac3',
  'audio/eac3': 'eac3',
};

function codecFromMime(
  trackMime: string | null | undefined,
  containerMime: string | null | undefined
): string | null {
  // Some framework extractors (e.g. FLAC) expose the decoded track as
  // audio/raw; the container mime identifies the real codec there.
  const mime = trackMime === 'audio/raw' && containerMime ? containerMime : trackMime;
  if (!mime) return null;
  return CODEC_BY_MIME[mime] ?? mime.replace(/^audio\//, '');
}

function fileExtension(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot >= 0 ? name.slice(dot + 1) : '';
}

function cleanTag(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

export function metadataToUpsertRow(
  meta: ExtractedMetadata,
  file: ScannedFile,
  folderId: number
): TrackUpsert {
  const extension = fileExtension(file.name);
  const title = cleanTag(meta.title) ?? file.name.slice(0, file.name.length - (extension ? extension.length + 1 : 0));
  const artist = cleanTag(meta.artist) ?? UNKNOWN_ARTIST;
  const album = cleanTag(meta.album) ?? UNKNOWN_ALBUM;
  const albumArtist = cleanTag(meta.albumArtist);

  return {
    path: file.uri,
    folder_id: folderId,
    title,
    artist,
    album,
    album_artist: albumArtist,
    album_identity_key: buildAlbumIdentityKey(albumArtist, artist, album),
    duration: meta.durationMs != null ? meta.durationMs / 1000 : 0,
    track_number: meta.trackNumber ?? null,
    disc_number: meta.discNumber ?? null,
    year: meta.year ?? null,
    genre: cleanTag(meta.genre),
    artwork_hash: meta.artworkHash ?? null,
    format: extension ? extension.toUpperCase() : 'UNKNOWN',
    sample_rate: meta.sampleRate ?? null,
    bit_depth: meta.bitsPerSample ?? null,
    bitrate: meta.bitrate ?? null,
    channels: meta.channels ?? null,
    codec: codecFromMime(meta.codecMime, meta.mimeType),
    file_name: file.name,
    size: file.size,
    mtime: file.lastModified,
  };
}

export function dbTrackToTrack(track: DbTrack): Track {
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
    artworkData: track.artwork_hash ? artworkUri(track.artwork_hash) : undefined,
    artworkHash: track.artwork_hash ?? undefined,
    format: track.format,
    sampleRate: track.sample_rate ?? undefined,
    bitDepth: track.bit_depth ?? undefined,
    bitrate: track.bitrate ?? undefined,
    channels: track.channels ?? undefined,
    codec: track.codec ?? undefined,
    sourceType: track.source_type,
  };
}

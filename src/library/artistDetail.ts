import {
  filterTracksByArtist,
  normalizeKey,
  resolveCanonicalBrowseArtist,
  splitAlbumArtistCollaborators,
  type ArtistGroupingMode,
} from '@/library/artistGrouping';
import type { DbTrack } from '@/types/library';

export interface ArtistAlbum {
  identity_key: string;
  album: string;
  artist: string;
  year: number | null;
  artwork_hash: string | null;
  track_count: number;
  latest_added_at: number;
  duration: number;
}

export interface ArtistDetail {
  tracks: DbTrack[];
  mainTracks: DbTrack[];
  appearanceTracks: DbTrack[];
  songTracks: DbTrack[];
  albums: ArtistAlbum[];
  artworkHashes: string[];
  playbackTracks: DbTrack[];
  totalDuration: number;
  showAppearances: boolean;
}

export function buildArtistDetail(
  allTracks: readonly DbTrack[],
  artistName: string,
  mode: ArtistGroupingMode
): ArtistDetail {
  const tracks = filterTracksByArtist(allTracks, artistName, mode);
  const artistKey = normalizeKey(artistName);

  const mainTracks =
    mode === 'fileTags'
      ? tracks
      : tracks.filter((track) => isMainArtistTrack(track, artistKey));
  const appearanceTracks =
    mode === 'fileTags' ? [] : tracks.filter((track) => !isMainArtistTrack(track, artistKey));
  const songTracks = mainTracks.length > 0 ? mainTracks : tracks;
  const albums = buildArtistAlbums(mainTracks);

  return {
    tracks,
    mainTracks,
    appearanceTracks,
    songTracks,
    albums,
    artworkHashes: buildArtworkHashes(albums, tracks),
    playbackTracks: songTracks,
    totalDuration: tracks.reduce((sum, track) => sum + track.duration, 0),
    showAppearances: mainTracks.length > 0 && appearanceTracks.length > 0,
  };
}

function isMainArtistTrack(track: DbTrack, artistKey: string): boolean {
  if (!artistKey) return false;
  if (normalizeKey(resolveCanonicalBrowseArtist(track)) === artistKey) return true;
  if (normalizeKey(track.artist) === artistKey) return true;
  if (normalizeKey(track.album_artist ?? '') === artistKey) return true;
  return splitAlbumArtistCollaborators(track.album_artist ?? '').some(
    (name) => normalizeKey(name) === artistKey
  );
}

function buildArtistAlbums(tracks: readonly DbTrack[]): ArtistAlbum[] {
  const byKey = new Map<string, ArtistAlbum>();

  for (const track of tracks) {
    const existing = byKey.get(track.album_identity_key);
    if (existing) {
      existing.track_count += 1;
      existing.duration += track.duration;
      existing.latest_added_at = Math.max(existing.latest_added_at, track.added_at);
      if (existing.year == null && track.year != null) existing.year = track.year;
      if (!existing.artwork_hash && track.artwork_hash) existing.artwork_hash = track.artwork_hash;
      continue;
    }

    byKey.set(track.album_identity_key, {
      identity_key: track.album_identity_key,
      album: track.album,
      artist: track.album_artist ?? track.artist,
      year: track.year,
      artwork_hash: track.artwork_hash,
      track_count: 1,
      latest_added_at: track.added_at,
      duration: track.duration,
    });
  }

  return Array.from(byKey.values()).sort((a, b) => {
    if (a.year != null && b.year != null && a.year !== b.year) return b.year - a.year;
    if (a.year != null && b.year == null) return -1;
    if (a.year == null && b.year != null) return 1;
    return a.album.localeCompare(b.album, undefined, { sensitivity: 'base' });
  });
}

function buildArtworkHashes(albums: readonly ArtistAlbum[], tracks: readonly DbTrack[]): string[] {
  const hashes: string[] = [];
  const seen = new Set<string>();
  const add = (hash: string | null) => {
    if (!hash || seen.has(hash)) return;
    seen.add(hash);
    hashes.push(hash);
  };

  for (const album of albums) add(album.artwork_hash);
  for (const track of tracks) add(track.artwork_hash);
  return hashes;
}

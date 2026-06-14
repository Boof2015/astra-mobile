// Artist browse grouping — ported from desktop (astra src/main/services/library.ts
// and src/shared/library/artistCredits.ts). Two modes:
//   'astra'    (desktop "canonical"): parse the artist string into collaborators,
//              file each track under its primary artist, and also index it under
//              every collaborator so featured artists are browsable.
//   'fileTags' (desktop "strict"): use the tag verbatim (album_artist || artist).
//
// Mobile has no parsed `artist_names_json` columns (MMR yields one artist string),
// so desktop's parsed-array paths collapse to splitCollaborators(artist) — which is
// the parsing heuristic. Everything here is derivable from artist + album_artist.

import type { Artist, DbTrack } from '@/types/library';

export type ArtistGroupingMode = 'astra' | 'fileTags';

const UNKNOWN_ARTIST = 'Unknown Artist';

/** Track fields the grouping logic reads (subset of DbTrack, for testability). */
type ArtistTrackLike = Pick<
  DbTrack,
  'artist' | 'album_artist' | 'artwork_hash' | 'year' | 'added_at' | 'modified_at'
>;

export function normalizeDisplay(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

export function normalizeKey(value: string): string {
  return normalizeDisplay(value).toLocaleLowerCase();
}

/** Split "A & B feat. C; D" into ["A","B","C","D"], deduped by normalized key. */
export function splitCollaborators(rawArtist: string): string[] {
  const normalized = normalizeDisplay(rawArtist);
  if (!normalized) return [];

  const unified = normalized
    .replace(/\s*;\s*/g, ',')
    .replace(/\s+&\s+/g, ',')
    .replace(/\s+[x×]\s+/gi, ',')
    .replace(/\s+(?:feat\.?|ft\.?|featuring|with)\s+/gi, ',');

  return dedupeByKey(unified.split(','));
}

/** Like splitCollaborators but keeps "&" (e.g. "Earth, Wind & Fire" stays whole). */
export function splitAlbumArtistCollaborators(rawAlbumArtist: string): string[] {
  const normalized = normalizeDisplay(rawAlbumArtist);
  if (!normalized) return [];

  const unified = normalized
    .replace(/\s*;\s*/g, ',')
    .replace(/\s+[x×]\s+/gi, ',')
    .replace(/\s+(?:feat\.?|ft\.?|featuring|with)\s+/gi, ',');

  return dedupeByKey(unified.split(','));
}

function dedupeByKey(parts: string[]): string[] {
  const unique = new Map<string, string>();
  for (const part of parts) {
    const display = normalizeDisplay(part);
    if (!display) continue;
    const key = normalizeKey(display);
    if (!key || unique.has(key)) continue;
    unique.set(key, display);
  }
  return Array.from(unique.values());
}

/** File-tags artist: album_artist if present, else the raw track artist. */
export function resolveStrictBrowseArtist(track: Pick<DbTrack, 'artist' | 'album_artist'>): string {
  const albumArtist = normalizeDisplay(track.album_artist ?? '');
  if (albumArtist) return albumArtist;
  return normalizeDisplay(track.artist) || UNKNOWN_ARTIST;
}

/** Astra-grouping primary: album_artist's first collaborator, else artist's first. */
export function resolveCanonicalBrowseArtist(track: Pick<DbTrack, 'artist' | 'album_artist'>): string {
  const albumArtist = normalizeDisplay(track.album_artist ?? '');
  if (albumArtist) {
    return splitAlbumArtistCollaborators(albumArtist)[0] ?? albumArtist;
  }
  return splitCollaborators(track.artist)[0] ?? UNKNOWN_ARTIST;
}

/** Every artist a track is indexed under in astra mode: primary + all collaborators. */
export function getCanonicalArtistIndexNames(track: Pick<DbTrack, 'artist' | 'album_artist'>): string[] {
  const unique = new Map<string, string>();
  const add = (name: string) => {
    const display = normalizeDisplay(name);
    const key = normalizeKey(display);
    if (!key || unique.has(key)) return;
    unique.set(key, display);
  };

  add(resolveCanonicalBrowseArtist(track));

  const trackArtists = splitCollaborators(track.artist);
  for (const name of trackArtists) add(name);
  if (trackArtists.length === 0) {
    for (const name of splitAlbumArtistCollaborators(track.album_artist ?? '')) add(name);
  }

  return Array.from(unique.values());
}

/** Whether a track belongs to the given artist key under the active browse mode. */
export function trackMatchesBrowseArtist(
  track: Pick<DbTrack, 'artist' | 'album_artist'>,
  targetArtistKey: string,
  mode: ArtistGroupingMode
): boolean {
  const browseKey = normalizeKey(
    mode === 'fileTags' ? resolveStrictBrowseArtist(track) : resolveCanonicalBrowseArtist(track)
  );
  if (browseKey === targetArtistKey) return true;
  if (mode === 'fileTags') return false;

  const albumArtistKey = normalizeKey(track.album_artist ?? '');
  if (albumArtistKey && albumArtistKey === targetArtistKey) return true;

  const trackArtistKey = normalizeKey(track.artist);
  if (trackArtistKey && trackArtistKey === targetArtistKey) return true;

  if (splitAlbumArtistCollaborators(track.album_artist ?? '').some((n) => normalizeKey(n) === targetArtistKey)) {
    return true;
  }
  return splitCollaborators(track.artist).some((n) => normalizeKey(n) === targetArtistKey);
}

interface ArtistAggregate {
  artist: string;
  track_count: number;
  artwork_hash: string | null;
  artworkYear: number;
  artworkAddedAt: number;
  artworkModifiedAt: number;
}

/**
 * Aggregate the artist browse list from in-memory tracks (replaces SQL getArtists).
 * Artwork is the cover of the artist's newest track (year, then added/modified) —
 * matches desktop getArtists.
 */
export function buildArtistList(tracks: readonly ArtistTrackLike[], mode: ArtistGroupingMode): Artist[] {
  const byKey = new Map<string, ArtistAggregate>();

  for (const track of tracks) {
    const indexNames = mode === 'fileTags'
      ? [resolveStrictBrowseArtist(track)]
      : getCanonicalArtistIndexNames(track);

    const seen = new Set<string>();
    for (const name of indexNames) {
      const key = normalizeKey(name);
      if (!key || seen.has(key)) continue;
      seen.add(key);

      let aggregate = byKey.get(key);
      if (!aggregate) {
        aggregate = {
          artist: name,
          track_count: 0,
          artwork_hash: null,
          artworkYear: -1,
          artworkAddedAt: -1,
          artworkModifiedAt: -1,
        };
        byKey.set(key, aggregate);
      }
      aggregate.track_count += 1;

      if (!track.artwork_hash) continue;
      const candidateYear = track.year ?? -1;
      const better =
        aggregate.artwork_hash == null ||
        candidateYear > aggregate.artworkYear ||
        (candidateYear === aggregate.artworkYear &&
          (track.added_at > aggregate.artworkAddedAt ||
            (track.added_at === aggregate.artworkAddedAt && track.modified_at > aggregate.artworkModifiedAt)));
      if (!better) continue;
      aggregate.artwork_hash = track.artwork_hash;
      aggregate.artworkYear = candidateYear;
      aggregate.artworkAddedAt = track.added_at;
      aggregate.artworkModifiedAt = track.modified_at;
    }
  }

  return Array.from(byKey.values())
    .map(({ artist, track_count, artwork_hash }) => ({ artist, track_count, artwork_hash }))
    .sort((a, b) => a.artist.localeCompare(b.artist, undefined, { sensitivity: 'base' }));
}

/** Tracks belonging to one artist under the active mode (preserves input order). */
export function filterTracksByArtist(
  tracks: readonly DbTrack[],
  artistName: string,
  mode: ArtistGroupingMode
): DbTrack[] {
  const key = normalizeKey(artistName);
  if (!key) return [];
  return tracks.filter((track) => trackMatchesBrowseArtist(track, key, mode));
}

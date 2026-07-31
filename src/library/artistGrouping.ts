// Artist browse grouping — ported from desktop (astra src/main/services/library.ts
// and src/shared/library/artistCredits.ts). Two modes:
//   'astra'    (desktop "canonical"): parse the artist string into collaborators,
//              file each track under its primary artist, and also index it under
//              every collaborator so featured artists are browsable.
//   'fileTags' (desktop "strict"): use the tag verbatim (album_artist || artist).
//
// Structured artist arrays are preferred when present so punctuation inside an
// individual name is never mistaken for a collaboration boundary. Legacy and
// remote rows still fall back to the original display-string heuristics.

// Runtime imports stay relative so this module can run under plain `node --test`.
import { normalizeDisplay, normalizeKey, splitCollaborators } from '../shared/library/albumGrouping.ts';
import { normalizeArtistNames } from '../shared/library/artistCredits.ts';
import type { Artist, DbTrack } from '../types/library';

// Shared with the album-identity port so artist and album grouping can never
// drift apart on normalization or collaborator splitting.
export { normalizeDisplay, normalizeKey, splitCollaborators };

export type ArtistGroupingMode = 'astra' | 'fileTags';

const UNKNOWN_ARTIST = 'Unknown Artist';
const VARIOUS_ARTISTS_KEY = 'various artists';

/** Track fields the grouping logic reads (subset of DbTrack, for testability). */
export interface ArtistCreditTrackLike {
  artist: string;
  artist_names?: readonly string[] | null;
  album_artist: string | null;
  album_artist_names?: readonly string[] | null;
}

export type ArtistTrackLike = ArtistCreditTrackLike & Pick<
  DbTrack,
  'artwork_hash' | 'year' | 'added_at' | 'modified_at' | 'album_identity_key'
>;

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
export function resolveStrictBrowseArtist(track: ArtistCreditTrackLike): string {
  const albumArtist = normalizeDisplay(track.album_artist ?? '');
  if (albumArtist) return albumArtist;
  return normalizeDisplay(track.artist) || UNKNOWN_ARTIST;
}

/** Astra-grouping primary: album_artist's first collaborator, else artist's first. */
export function resolveCanonicalBrowseArtist(track: ArtistCreditTrackLike): string {
  const albumArtist = normalizeDisplay(track.album_artist ?? '');
  if (albumArtist) {
    const parsedAlbumArtists = normalizeArtistNames(track.album_artist_names);
    if (parsedAlbumArtists.length > 0) return parsedAlbumArtists[0];
    return splitAlbumArtistCollaborators(albumArtist)[0] ?? albumArtist;
  }
  const parsedTrackArtists = normalizeArtistNames(track.artist_names);
  if (parsedTrackArtists.length > 0) return parsedTrackArtists[0];
  return splitCollaborators(track.artist)[0] ?? UNKNOWN_ARTIST;
}

/** Every artist a track is indexed under in astra mode: primary + all collaborators. */
export function getCanonicalArtistIndexNames(track: ArtistCreditTrackLike): string[] {
  const unique = new Map<string, string>();
  const add = (name: string) => {
    const display = normalizeDisplay(name);
    const key = normalizeKey(display);
    if (!key || unique.has(key)) return;
    unique.set(key, display);
  };

  add(resolveCanonicalBrowseArtist(track));

  const parsedTrackArtists = normalizeArtistNames(track.artist_names);
  const trackArtists =
    parsedTrackArtists.length > 0 ? parsedTrackArtists : splitCollaborators(track.artist);
  for (const name of trackArtists) add(name);
  if (trackArtists.length === 0) {
    const parsedAlbumArtists = normalizeArtistNames(track.album_artist_names);
    const albumArtists =
      parsedAlbumArtists.length > 0
        ? parsedAlbumArtists
        : splitAlbumArtistCollaborators(track.album_artist ?? '');
    for (const name of albumArtists) add(name);
  }

  return Array.from(unique.values());
}

/**
 * Per-track "View artist" destination. "Various Artists" is an album-level
 * placeholder, not a person — in astra mode fall through to the track's own
 * primary artist (desktop parity: album artist links are nulled when they
 * normalize to Various Artists). File-tags mode keeps the tag verbatim: the VA
 * bucket is the only artist page that lists those tracks in that mode.
 */
export function resolveNavigationArtist(
  track: ArtistCreditTrackLike,
  mode: ArtistGroupingMode
): string {
  if (mode === 'fileTags') return resolveStrictBrowseArtist(track);
  const canonical = resolveCanonicalBrowseArtist(track);
  if (normalizeKey(canonical) !== VARIOUS_ARTISTS_KEY) return canonical;
  return normalizeArtistNames(track.artist_names)[0] ?? splitCollaborators(track.artist)[0] ?? canonical;
}

/** Whether a track belongs to the given artist key under the active browse mode. */
export function trackMatchesBrowseArtist(
  track: ArtistCreditTrackLike,
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

  if (normalizeArtistNames(track.album_artist_names).some((n) => normalizeKey(n) === targetArtistKey)) {
    return true;
  }
  if (splitAlbumArtistCollaborators(track.album_artist ?? '').some((n) => normalizeKey(n) === targetArtistKey)) {
    return true;
  }
  if (normalizeArtistNames(track.artist_names).some((n) => normalizeKey(n) === targetArtistKey)) {
    return true;
  }
  return splitCollaborators(track.artist).some((n) => normalizeKey(n) === targetArtistKey);
}

interface ArtistAggregate {
  artist: string;
  track_count: number;
  primary_track_count: number;
  artwork_hash: string | null;
  artworkYear: number;
  artworkAddedAt: number;
  artworkModifiedAt: number;
  albumKeys: Set<string>;
  /** First artwork hash seen per album — feeds the grid's 2x2 mosaic. */
  albumArtwork: Map<string, string>;
}

/**
 * Aggregate the artist browse list from in-memory tracks (replaces SQL getArtists).
 * Artwork is the cover of the artist's newest track (year, then added/modified) —
 * matches desktop getArtists.
 */
export function buildArtistList(tracks: readonly ArtistTrackLike[], mode: ArtistGroupingMode): Artist[] {
  const byKey = new Map<string, ArtistAggregate>();

  for (const track of tracks) {
    const primaryArtistKey = normalizeKey(
      mode === 'fileTags'
        ? resolveStrictBrowseArtist(track)
        : resolveCanonicalBrowseArtist(track)
    );
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
          primary_track_count: 0,
          artwork_hash: null,
          artworkYear: -1,
          artworkAddedAt: -1,
          artworkModifiedAt: -1,
          albumKeys: new Set(),
          albumArtwork: new Map(),
        };
        byKey.set(key, aggregate);
      }
      aggregate.track_count += 1;
      if (key === primaryArtistKey) aggregate.primary_track_count += 1;
      aggregate.albumKeys.add(track.album_identity_key);

      if (!track.artwork_hash) continue;
      if (!aggregate.albumArtwork.has(track.album_identity_key)) {
        aggregate.albumArtwork.set(track.album_identity_key, track.artwork_hash);
      }
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
    .map(({ artist, track_count, primary_track_count, artwork_hash, albumKeys, albumArtwork }) => {
      // Primary artwork first, then one distinct cover per further album (max 4).
      const artwork_hashes: string[] = artwork_hash ? [artwork_hash] : [];
      for (const hash of albumArtwork.values()) {
        if (artwork_hashes.length >= 4) break;
        if (!artwork_hashes.includes(hash)) artwork_hashes.push(hash);
      }
      return {
        artist,
        track_count,
        primary_track_count,
        artwork_hash,
        artwork_source: artwork_hash ? 'track' as const : null,
        album_count: albumKeys.size,
        artwork_hashes,
      };
    })
    .sort((a, b) => a.artist.localeCompare(b.artist, undefined, { sensitivity: 'base' }));
}

/** Apply the Artists-root collaborator preference without changing detail/search data. */
export function filterArtistBrowseList(
  artists: Artist[],
  mode: ArtistGroupingMode,
  includeCollabArtists: boolean
): Artist[] {
  if (mode !== 'astra' || includeCollabArtists) return artists;
  return artists.filter((artist) => artist.primary_track_count > 0);
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

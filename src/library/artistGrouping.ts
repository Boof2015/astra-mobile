// Astra Resolve browse adapters. Catalog-backed rows carry identities computed
// over the full library; pure callers can supply the same complete evidence index.
import { normalizeDisplay, splitCollaborators } from '../shared/library/albumGrouping.ts';
import {
  normalizeArtistNames, normalizeArtistKey as normalizeKey, normalizeIdentityKey, canonicalizeArtistDisplay,
  buildArtistIdentityIndex, resolveTrackArtistNames, type ArtistIdentityIndex,
} from '../shared/library/artistCredits.ts';
import type { Artist, DbTrack } from '../types/library';
export { normalizeDisplay, normalizeKey, splitCollaborators };

export type ArtistGroupingMode = 'astra' | 'fileTags';

const UNKNOWN_ARTIST = 'Unknown Artist';
const VARIOUS_ARTISTS_KEY = 'various artists';

/** Track fields the grouping logic reads (subset of DbTrack, for testability). */
export interface ArtistCreditTrackLike {
  artist: string;
  album?: string | null;
  resolved_artist_names?: readonly string[] | null;
  resolved_album_artist_names?: readonly string[] | null;
  artist_names?: readonly string[] | null;
  album_artist: string | null;
  album_artist_names?: readonly string[] | null;
}

export type ArtistTrackLike = ArtistCreditTrackLike & Pick<
  DbTrack,
  'artwork_hash' | 'year' | 'added_at' | 'modified_at' | 'album_identity_key'
>;

export function splitAlbumArtistCollaborators(rawAlbumArtist: string): string[] {
  const track = { artist: '', album_artist: rawAlbumArtist };
  return resolveTrackArtistNames(track, buildArtistIdentityIndex([track]), true);
}

export function resolvedCreditNames(
  track: ArtistCreditTrackLike, albumArtist = false, index?: ArtistIdentityIndex
): string[] {
  const resolved = albumArtist ? track.resolved_album_artist_names : track.resolved_artist_names;
  if (resolved != null) return normalizeArtistNames(resolved);
  return resolveTrackArtistNames(track, index ?? buildArtistIdentityIndex([track]), albumArtist);
}

export function resolveStrictBrowseArtist(track: ArtistCreditTrackLike): string {
  return normalizeDisplay(track.album_artist ?? '') || normalizeDisplay(track.artist) || UNKNOWN_ARTIST;
}

export function resolveCanonicalBrowseArtist(track: ArtistCreditTrackLike, index?: ArtistIdentityIndex): string {
  return canonicalizeArtistDisplay(
    resolvedCreditNames(track, true, index)[0] ?? resolvedCreditNames(track, false, index)[0] ?? UNKNOWN_ARTIST
  );
}

export function getCanonicalArtistIndexNames(track: ArtistCreditTrackLike, index?: ArtistIdentityIndex): string[] {
  return normalizeArtistNames([
    resolveCanonicalBrowseArtist(track, index),
    ...resolvedCreditNames(track, false, index),
    ...resolvedCreditNames(track, true, index),
  ]).map(canonicalizeArtistDisplay);
}

export function resolveNavigationArtist(track: ArtistCreditTrackLike, mode: ArtistGroupingMode): string {
  if (mode === 'fileTags') return resolveStrictBrowseArtist(track);
  const canonical = resolveCanonicalBrowseArtist(track);
  return normalizeKey(canonical) === VARIOUS_ARTISTS_KEY
    ? resolvedCreditNames(track)[0] ?? canonical
    : canonical;
}

export function trackMatchesBrowseArtist(
  track: ArtistCreditTrackLike, targetArtistKey: string, mode: ArtistGroupingMode, index?: ArtistIdentityIndex
): boolean {
  if (mode === 'fileTags') return normalizeIdentityKey(resolveStrictBrowseArtist(track)) === targetArtistKey;
  return getCanonicalArtistIndexNames(track, index).some((name) => normalizeKey(name) === targetArtistKey)
    || normalizeKey(track.artist) === targetArtistKey
    || normalizeKey(track.album_artist ?? '') === targetArtistKey;
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
  const index = buildArtistIdentityIndex(tracks);

  for (const track of tracks) {
    const keyForMode = mode === 'fileTags' ? normalizeIdentityKey : normalizeKey;
    const primaryArtistKey = keyForMode(
      mode === 'fileTags'
        ? resolveStrictBrowseArtist(track)
        : resolveCanonicalBrowseArtist(track, index)
    );
    const indexNames = mode === 'fileTags'
      ? [resolveStrictBrowseArtist(track)]
      : getCanonicalArtistIndexNames(track, index);

    const seen = new Set<string>();
    for (const name of indexNames) {
      const key = keyForMode(name);
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
      if (key === primaryArtistKey) {
        aggregate.primary_track_count += 1;
        // Albums the artist only guests on are not their albums; counting them
        // here credited a Various Artists compilation to every featured
        // performer. albumArtwork below stays ungated so they keep a mosaic.
        aggregate.albumKeys.add(track.album_identity_key);
      }

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
  const key = mode === 'fileTags' ? normalizeIdentityKey(artistName) : normalizeKey(artistName);
  if (!key) return [];
  const index = buildArtistIdentityIndex(tracks);
  return tracks.filter((track) => trackMatchesBrowseArtist(track, key, mode, index));
}

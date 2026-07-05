// Album browse list built in JS from in-memory tracks (replaces SQL getAlbums),
// mirroring desktop getAlbums summaries: most-frequent display variants and a
// deterministic artwork pick instead of arbitrary MAX() aggregates, plus the
// desktop eligibility rules (no "Unknown Album"; singles behind a toggle).
//
// Groups by the *stored* album_identity_key — never re-runs the tier logic and
// never parses the key (album names can themselves contain "::"); the stored
// column is the single source of truth shared with Android Auto.
//
// Runtime imports are relative (not '@/') so this module runs under `node --test`.

import { normalizeAlbumName, normalizeKey } from '../shared/library/albumGrouping.ts';
import { isAlbumGroupEligible } from '../shared/library/albumEligibility.ts';
import type { Album, DbTrack } from '../types/library';

export interface AlbumSummaryOptions {
  includeSingles?: boolean;
}

/** Track fields the summary reads (subset of DbTrack, for testability). */
export type AlbumSummaryTrackLike = Pick<
  DbTrack,
  | 'album_identity_key'
  | 'album'
  | 'artist'
  | 'album_artist'
  | 'album_display_artist'
  | 'year'
  | 'artwork_hash'
  | 'added_at'
  | 'source_type'
  | 'source_id'
  | 'artwork_source_id'
>;

interface CountedDisplayVariant {
  display: string;
  count: number;
}

function incrementDisplayVariant(map: Map<string, CountedDisplayVariant>, display: string): void {
  const key = normalizeKey(display);
  if (!key) return;
  const existing = map.get(key);
  if (existing) {
    existing.count += 1;
    return;
  }
  map.set(key, { display, count: 1 });
}

// Desktop library.ts pickMostFrequentDisplayVariant: highest count, ties go to
// the lexicographically smallest display string (deterministic across scans).
function pickMostFrequentDisplayVariant(
  map: Map<string, CountedDisplayVariant>,
  fallback: string
): string {
  let best: CountedDisplayVariant | null = null;
  for (const variant of map.values()) {
    if (!best || variant.count > best.count) {
      best = variant;
      continue;
    }
    if (
      variant.count === best.count &&
      variant.display.localeCompare(best.display, undefined, { sensitivity: 'base' }) < 0
    ) {
      best = variant;
    }
  }
  return best?.display ?? fallback;
}

// Desktop library.ts pickMostFrequentArtworkHash.
function pickMostFrequentArtworkHash(
  artworkCounts: Map<string, number>,
  fallback: string | null
): string | null {
  let bestHash: string | null = null;
  let bestCount = -1;

  for (const [hash, count] of artworkCounts.entries()) {
    if (count > bestCount) {
      bestHash = hash;
      bestCount = count;
      continue;
    }
    if (count === bestCount && bestHash && hash.localeCompare(bestHash) < 0) {
      bestHash = hash;
    }
  }

  return bestHash ?? fallback;
}

interface AlbumAggregate {
  albumKey: string;
  albumVariants: Map<string, CountedDisplayVariant>;
  displayArtist: string | null;
  fallbackArtist: string;
  year: number | null;
  artworkCounts: Map<string, number>;
  firstArtworkHash: string | null;
  trackCount: number;
  latestAddedAt: number;
  sourceType: DbTrack['source_type'];
  sourceId: number | null;
  artworkSourceId: string | null;
}

export function buildAlbumList(
  tracks: readonly AlbumSummaryTrackLike[],
  options: AlbumSummaryOptions = {}
): Album[] {
  const byKey = new Map<string, AlbumAggregate>();

  for (const track of tracks) {
    let aggregate = byKey.get(track.album_identity_key);
    if (!aggregate) {
      aggregate = {
        // Uniform across the group by construction: every grouping tier keys
        // on the normalized album name, so the first track's key is the key.
        albumKey: normalizeKey(normalizeAlbumName(track.album)),
        albumVariants: new Map(),
        displayArtist: null,
        fallbackArtist: track.album_artist ?? track.artist,
        year: null,
        artworkCounts: new Map(),
        firstArtworkHash: null,
        trackCount: 0,
        latestAddedAt: track.added_at,
        sourceType: 'local',
        sourceId: null,
        artworkSourceId: null,
      };
      byKey.set(track.album_identity_key, aggregate);
    }

    aggregate.trackCount += 1;
    incrementDisplayVariant(aggregate.albumVariants, normalizeAlbumName(track.album));
    // Uniform within a group after the recompute pass; provisional rows may
    // still be null, hence the first-non-null pick + tag fallback.
    if (aggregate.displayArtist == null && track.album_display_artist) {
      aggregate.displayArtist = track.album_display_artist;
    }
    if (track.year != null && (aggregate.year == null || track.year > aggregate.year)) {
      aggregate.year = track.year;
    }
    if (track.artwork_hash) {
      if (!aggregate.firstArtworkHash) aggregate.firstArtworkHash = track.artwork_hash;
      aggregate.artworkCounts.set(
        track.artwork_hash,
        (aggregate.artworkCounts.get(track.artwork_hash) ?? 0) + 1
      );
    }
    if (track.added_at > aggregate.latestAddedAt) aggregate.latestAddedAt = track.added_at;
    // Representative remote-source linkage: first remote track carries it.
    if (aggregate.sourceType === 'local' && track.source_type !== 'local') {
      aggregate.sourceType = track.source_type;
      aggregate.sourceId = track.source_id;
      aggregate.artworkSourceId = track.artwork_source_id;
    }
  }

  const albums: Album[] = [];
  for (const [identityKey, aggregate] of byKey.entries()) {
    if (!isAlbumGroupEligible(
      { albumKey: aggregate.albumKey, trackCount: aggregate.trackCount },
      { includeSingles: options.includeSingles }
    )) {
      continue;
    }
    albums.push({
      identity_key: identityKey,
      album: pickMostFrequentDisplayVariant(aggregate.albumVariants, 'Unknown Album'),
      artist: aggregate.displayArtist ?? aggregate.fallbackArtist,
      year: aggregate.year,
      artwork_hash: pickMostFrequentArtworkHash(aggregate.artworkCounts, aggregate.firstArtworkHash),
      track_count: aggregate.trackCount,
      latest_added_at: aggregate.latestAddedAt,
      source_type: aggregate.sourceType,
      source_id: aggregate.sourceId,
      artwork_source_id: aggregate.artworkSourceId,
    });
  }

  // Artist → album, matching the old SQL getAlbums ORDER BY: the albums view's
  // 'artist' sort mode uses this native order (src/lib/albumSort.ts).
  return albums.sort((a, b) => {
    const artistCompare = a.artist.localeCompare(b.artist, undefined, { sensitivity: 'base' });
    if (artistCompare !== 0) return artistCompare;
    return a.album.localeCompare(b.album, undefined, { sensitivity: 'base' });
  });
}

import type { Artist } from '@/types/library';
import { compareDirected, type SortDirection } from './sortDirection.ts';

export type ArtistSort = 'name' | 'track_count';

export const ARTIST_SORT_LABELS: Record<ArtistSort, string> = {
  name: 'Name',
  track_count: 'Track count',
};

export const ARTIST_SORT_LEGACY_DIRECTIONS: Record<ArtistSort, SortDirection> = {
  name: 'asc',
  track_count: 'desc',
};

/** Mirrors the native primary-direction/forward-tiebreak ordering. */
export function sortArtists(
  artists: Artist[],
  sort: ArtistSort,
  direction: SortDirection = ARTIST_SORT_LEGACY_DIRECTIONS[sort],
): Artist[] {
  switch (sort) {
    case 'name':
      return [...artists].sort((a, b) =>
        compareDirected(a.artist, b.artist, direction, (left, right) => left.localeCompare(right))
      );
    case 'track_count':
      return [...artists].sort(
        (a, b) =>
          compareDirected(a.track_count, b.track_count, direction, (left, right) => left - right) ||
          a.artist.localeCompare(b.artist)
      );
  }
}

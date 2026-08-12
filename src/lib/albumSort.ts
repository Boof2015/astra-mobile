import type { Album } from '@/types/library';
import { compareDirected, type SortDirection } from './sortDirection.ts';

export type AlbumSort = 'artist' | 'name' | 'recently_added' | 'year';

export const ALBUM_SORT_LABELS: Record<AlbumSort, string> = {
  artist: 'Artist',
  name: 'Name',
  recently_added: 'Recently added',
  year: 'Year',
};

export const ALBUM_SORT_LEGACY_DIRECTIONS: Record<AlbumSort, SortDirection> = {
  artist: 'asc',
  name: 'asc',
  recently_added: 'desc',
  year: 'desc',
};

/** Mirrors the native primary-direction/forward-tiebreak ordering. */
export function sortAlbums(
  albums: Album[],
  sort: AlbumSort,
  direction: SortDirection = ALBUM_SORT_LEGACY_DIRECTIONS[sort],
): Album[] {
  switch (sort) {
    case 'artist':
      return [...albums].sort((a, b) =>
        compareDirected(a.artist, b.artist, direction, (left, right) => left.localeCompare(right)) ||
        a.album.localeCompare(b.album) ||
        a.identity_key.localeCompare(b.identity_key)
      );
    case 'name':
      return [...albums].sort((a, b) =>
        compareDirected(a.album, b.album, direction, (left, right) => left.localeCompare(right)) ||
        a.identity_key.localeCompare(b.identity_key)
      );
    case 'recently_added':
      return [...albums].sort((a, b) =>
        compareDirected(a.latest_added_at, b.latest_added_at, direction, (left, right) => left - right) ||
        a.identity_key.localeCompare(b.identity_key)
      );
    case 'year':
      // Unknown years stay last in either direction.
      return [...albums].sort((a, b) => {
        if (a.year == null && b.year == null) {
          return a.album.localeCompare(b.album) || a.identity_key.localeCompare(b.identity_key);
        }
        if (a.year == null) return 1;
        if (b.year == null) return -1;
        return compareDirected(a.year, b.year, direction, (left, right) => left - right) ||
          a.album.localeCompare(b.album) ||
          a.identity_key.localeCompare(b.identity_key);
      });
  }
}

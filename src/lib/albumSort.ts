import type { Album } from '@/types/library';

export type AlbumSort = 'artist' | 'name' | 'recently_added' | 'year';

export const ALBUM_SORT_LABELS: Record<AlbumSort, string> = {
  artist: 'Artist',
  name: 'Name',
  recently_added: 'Recently added',
  year: 'Year',
};

/** 'artist' is the DB's native order (getAlbums); others sort a copy. */
export function sortAlbums(albums: Album[], sort: AlbumSort): Album[] {
  switch (sort) {
    case 'artist':
      return albums;
    case 'name':
      return [...albums].sort((a, b) => a.album.localeCompare(b.album));
    case 'recently_added':
      return [...albums].sort((a, b) => b.latest_added_at - a.latest_added_at);
    case 'year':
      // Newest first, unknown years last, name tiebreak.
      return [...albums].sort((a, b) => {
        if (a.year == null && b.year == null) return a.album.localeCompare(b.album);
        if (a.year == null) return 1;
        if (b.year == null) return -1;
        return b.year - a.year || a.album.localeCompare(b.album);
      });
  }
}

import type { Artist } from '@/types/library';

export type ArtistSort = 'name' | 'track_count';

export const ARTIST_SORT_LABELS: Record<ArtistSort, string> = {
  name: 'Name',
  track_count: 'Track count',
};

/** 'name' is buildArtistList's native order; track count sorts a copy, most first. */
export function sortArtists(artists: Artist[], sort: ArtistSort): Artist[] {
  switch (sort) {
    case 'name':
      return artists;
    case 'track_count':
      return [...artists].sort(
        (a, b) => b.track_count - a.track_count || a.artist.localeCompare(b.artist)
      );
  }
}

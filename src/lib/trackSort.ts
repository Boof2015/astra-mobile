import type { DbTrack } from '@/types/library';
import { compareDirected, type SortDirection } from './sortDirection.ts';

export type TrackSort = 'artist' | 'title' | 'recently_added' | 'duration';

export const TRACK_SORT_LABELS: Record<TrackSort, string> = {
  artist: 'Artist',
  title: 'Title',
  recently_added: 'Recently added',
  duration: 'Duration',
};

export const TRACK_SORT_LEGACY_DIRECTIONS: Record<TrackSort, SortDirection> = {
  artist: 'asc',
  title: 'asc',
  recently_added: 'desc',
  duration: 'desc',
};

/** Mirrors the native primary-direction/forward-tiebreak ordering. */
export function sortTracks(
  tracks: DbTrack[],
  sort: TrackSort,
  direction: SortDirection = TRACK_SORT_LEGACY_DIRECTIONS[sort],
): DbTrack[] {
  switch (sort) {
    case 'artist':
      return [...tracks].sort((a, b) =>
        compareDirected(a.artist, b.artist, direction, (left, right) => left.localeCompare(right)) ||
        a.album.localeCompare(b.album) ||
        (a.disc_number ?? 0) - (b.disc_number ?? 0) ||
        (a.track_number ?? 0) - (b.track_number ?? 0) ||
        a.title.localeCompare(b.title) ||
        a.path.localeCompare(b.path)
      );
    case 'title':
      return [...tracks].sort((a, b) =>
        compareDirected(a.title, b.title, direction, (left, right) => left.localeCompare(right)) ||
        a.path.localeCompare(b.path)
      );
    case 'recently_added':
      return [...tracks].sort((a, b) =>
        compareDirected(a.added_at, b.added_at, direction, (left, right) => left - right) ||
        a.path.localeCompare(b.path)
      );
    case 'duration':
      return [...tracks].sort((a, b) =>
        compareDirected(a.duration, b.duration, direction, (left, right) => left - right) ||
        a.path.localeCompare(b.path)
      );
  }
}

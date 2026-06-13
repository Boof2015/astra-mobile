import type { DbTrack } from '@/types/library';

export type TrackSort = 'artist' | 'title' | 'recently_added' | 'duration';

export const TRACK_SORT_LABELS: Record<TrackSort, string> = {
  artist: 'Artist',
  title: 'Title',
  recently_added: 'Recently added',
  duration: 'Duration',
};

/** 'artist' is the DB's native order (getAllTracks); others sort a copy. */
export function sortTracks(tracks: DbTrack[], sort: TrackSort): DbTrack[] {
  switch (sort) {
    case 'artist':
      return tracks;
    case 'title':
      return [...tracks].sort((a, b) => a.title.localeCompare(b.title));
    case 'recently_added':
      return [...tracks].sort((a, b) => b.added_at - a.added_at);
    case 'duration':
      return [...tracks].sort((a, b) => b.duration - a.duration);
  }
}

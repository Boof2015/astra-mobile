// Library row types — a mobile subset of desktop `DbTrack` (libraryStore.ts).
// SQLite-backed scanning lands at M1; this shape lets the store/UI be typed now.

export type TrackSourceType = 'local' | 'subsonic' | 'jellyfin';

export interface DbTrack {
  id: number;
  path: string;
  title: string;
  artist: string;
  album: string;
  album_artist: string | null;
  duration: number;
  track_number: number | null;
  disc_number: number | null;
  year: number | null;
  genre: string | null;
  artwork_hash: string | null;
  format: string;
  sample_rate: number | null;
  bit_depth: number | null;
  bitrate: number | null;
  channels: number | null;
  codec: string | null;
  source_type: TrackSourceType;
  added_at: number;
}

export interface Album {
  identity_key: string;
  album: string;
  artist: string;
  year: number | null;
  artwork_hash: string | null;
  track_count: number;
}

export interface Artist {
  artist: string;
  track_count: number;
  artwork_hash: string | null;
}

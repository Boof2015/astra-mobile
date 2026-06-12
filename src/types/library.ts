// Library row types — a mobile subset of desktop `DbTrack` (libraryStore.ts).
// SQLite-backed scanning lands at M1; this shape lets the store/UI be typed now.

export type TrackSourceType = 'local' | 'subsonic' | 'jellyfin';

export interface DbTrack {
  id: number;
  path: string; // SAF document content:// URI for local tracks
  folder_id: number;
  title: string;
  artist: string;
  album: string;
  album_artist: string | null;
  album_identity_key: string;
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
  file_name: string;
  size: number | null;
  mtime: number;
  added_at: number;
  modified_at: number;
}

export interface LibraryFolder {
  id: number;
  tree_uri: string;
  display_name: string;
  added_at: number;
  last_scanned_at: number | null;
  /** Computed against persisted URI permissions at load time — not stored. */
  available: boolean;
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

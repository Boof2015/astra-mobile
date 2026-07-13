// Library row types — a mobile subset of desktop `DbTrack` (libraryStore.ts).
// SQLite-backed scanning lands at M1; this shape lets the store/UI be typed now.

export type TrackSourceType = 'local' | 'subsonic' | 'jellyfin';

export interface DbTrack {
  id: number;
  path: string; // SAF content:// URI (local), or subsonic://|jellyfin:// identity URI (remote)
  folder_id: number | null; // NULL for remote tracks (no SAF folder)
  title: string;
  artist: string;
  album: string;
  album_artist: string | null;
  album_identity_key: string;
  /** Settled group artist ("Various Artists" for shared-artwork compilations);
   *  written by the album-identity recompute pass, NULL until it first runs. */
  album_display_artist: string | null;
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
  bpm: number | null;
  musical_key: string | null;
  source_type: TrackSourceType;
  // Remote-source linkage (NULL for local tracks). source_id -> remote_sources.id;
  // source_track_id is the server's track id; artwork_source_id is its cover-art id.
  source_id: number | null;
  source_track_id: string | null;
  source_path: string | null;
  artwork_source_id: string | null;
  file_name: string;
  size: number | null;
  mtime: number;
  added_at: number;
  modified_at: number;
  play_count: number;
  last_played_at: number | null;
  // M4 loudness facts (NULL until analyzed). loudness_lufs: integrated LUFS (dB,
  // negative); sample_peak: linear [0,1]; replay_gain_*: tag dB when present.
  loudness_lufs: number | null;
  sample_peak: number | null;
  replay_gain_track_db: number | null;
  replay_gain_album_db: number | null;
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
  /** Newest track import timestamp in this album, used by Home recently-added. */
  latest_added_at: number;
  // Representative remote-source linkage (absent/NULL for local albums) so the album
  // grid / detail can resolve a server cover-art URL when there's no cached artwork_hash.
  // Optional so locally-derived album shapes (e.g. artist-detail aggregates) still fit.
  source_type?: TrackSourceType;
  source_id?: number | null;
  artwork_source_id?: string | null;
}

export interface Artist {
  artist: string;
  track_count: number;
  /** Tracks where this artist is the resolved primary browse artist. */
  primary_track_count: number;
  artwork_hash: string | null;
  album_count: number;
  /** Primary hash first, then one distinct cover per further album (max 4) — grid mosaic. */
  artwork_hashes: string[];
}

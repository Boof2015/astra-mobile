// Playlist row types — mobile port of the desktop playlist model
// (astra src/main/services/library.ts, renderer playlistStore.ts).

import type { DbTrack } from './library';

export interface Playlist {
  id: number;
  name: string;
  created_at: number;
  updated_at: number;
  last_played_at: number | null;
  /** First entry's artwork — computed, not stored. */
  auto_cover_hash: string | null;
  /** Entries whose track exists in the library. */
  track_count: number;
  /** Entries whose track is gone (folder removed / file deleted). */
  missing_track_count: number;
}

export interface PlaylistTrackEntry {
  id: number;
  track_path: string;
  position: number;
  added_at: number;
  missing: boolean;
  fallback_title: string | null;
  fallback_artist: string | null;
  fallback_album: string | null;
  track: DbTrack | null;
}

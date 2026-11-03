// Playlist row types — mobile port of the desktop playlist model
// (astra src/main/services/library.ts, renderer playlistStore.ts).

import type { DbTrack } from './library';
import type { PlaylistKind } from '@/shared/playlists/dynamicPlaylist';

export interface PlaylistSummary {
  /** Entries whose track exists in the library, across the entire collection. */
  track_count: number;
  /** Entries whose track is gone (folder removed / file deleted). */
  missing_track_count: number;
  /** Duration of all available tracks, in seconds. */
  total_duration: number;
}

export interface Playlist extends PlaylistSummary {
  id: number;
  name: string;
  kind: PlaylistKind;
  created_at: number;
  updated_at: number;
  last_played_at: number | null;
  /** First entry's artwork — computed, not stored. */
  auto_cover_hash: string | null;
  /** Set when this playlist mirrors a remote server playlist (-> remote_sources.id). */
  remote_source_id: number | null;
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

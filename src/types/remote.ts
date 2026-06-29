// Shared types for remote music sources (Subsonic / Jellyfin). The catalog-track
// and connection-config shapes are ported verbatim from desktop Astra
// (src/main/services/{subsonic,jellyfin}.ts) — they were already identical across
// both providers, so they unify here.

export type RemoteSourceType = 'subsonic' | 'jellyfin';

export type RemoteSourceStatus = 'unknown' | 'ok' | 'error' | 'disabled' | 'syncing';

/** Credentials needed to talk to a server. */
export interface RemoteConnectionConfig {
  baseUrl: string;
  username: string;
  password: string;
}

/**
 * One catalog track as produced by a client sync. Maps 1:1 onto the `tracks` table
 * (plus remote-only id/path fields). Mirrors desktop `SubsonicCatalogTrack` /
 * `JellyfinCatalogTrack`.
 */
export interface RemoteCatalogTrack {
  /** Stable identity URI: `subsonic://{sourceId}/track/{id}` (stored as tracks.path). */
  path: string;
  source_track_id: string;
  source_path: string | null;
  artwork_source_id: string | null;
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
  codec_profile: string | null;
  is_atmos_joc: number | null;
  replaygain_track_gain_db: number | null;
  replaygain_album_gain_db: number | null;
  bpm: number | null;
  musical_key: string | null;
}

/** Unified sync-progress event across providers. */
export interface RemoteSyncProgress {
  phase: 'connecting' | 'artists' | 'albums' | 'tracks' | 'items' | 'playlists' | 'saving';
  current: number;
  total: number;
  detail: string | null;
}

/** A track entry within a synced remote playlist. */
export interface RemotePlaylistTrack {
  /** subsonic://|jellyfin:// identity URI (matches a tracks.path). */
  path: string;
  source_track_id: string;
  title: string | null;
  artist: string | null;
  album: string | null;
}

/** A playlist as defined on the remote server. */
export interface RemotePlaylist {
  source_playlist_id: string;
  name: string;
  tracks: RemotePlaylistTrack[];
}

/** A configured server, as stored in the `remote_sources` table (no secret). */
export interface RemoteSourceRow {
  id: number;
  type: RemoteSourceType;
  name: string;
  base_url: string;
  username: string;
  enabled: number; // 0 | 1
  last_status: RemoteSourceStatus;
  last_error: string | null;
  last_sync_at: number | null;
  last_checked_at: number | null;
  /** Jellyfin-only cached auth (Subsonic re-derives a salted token per request). */
  access_token: string | null;
  user_id: string | null;
  device_id: string | null;
  /**
   * A self-contained cover-art URL template with an `__ASTRA_ART_ID__` id placeholder,
   * read by the native Android Auto artwork provider to fetch server art without JS.
   */
  art_auth: string | null;
  created_at: number;
  updated_at: number;
}

export interface RemoteSourceCreateInput {
  type: RemoteSourceType;
  name: string;
  baseUrl: string;
  username: string;
  password: string;
  enabled: boolean;
}

export interface RemoteSourceUpdateInput {
  name?: string;
  baseUrl?: string;
  username?: string;
  /** Only set when the user enters a new password. */
  password?: string;
  enabled?: boolean;
}

export interface RemoteSourceTestInput {
  type: RemoteSourceType;
  baseUrl: string;
  username: string;
  password: string;
}

export interface RemoteSourceTestResult {
  ok: boolean;
  message: string;
}

// Library schema — a trimmed port of the desktop schema (astra
// src/main/services/library.ts). v1 covers M1 (local scan + browse);
// v2 adds playlists + favorites (M2); v3 forces re-extraction of tracks whose
// non-ASCII tags were truncated by the pre-fix op-sqlite binding (see database.ts);
// v4 adds a key-value settings table (artist grouping mode, future prefs);
// v5 caches offline waveform peaks for the M3 waveform seek bar; v6 repairs DBs
// that an abandoned earlier M3 spike left at v5 with a stale `waveform_cache`;
// v7 (M4) adds per-track loudness facts (integrated LUFS + sample peak + ReplayGain
// tags) measured for normalization; v8 clears any loudness measured by the earlier
// ungated whole-file method so it re-measures with the fast gated subset method;
// v9 adds ReplayGain peak columns + an `rg_scanned` sentinel so tag reading runs
// once per track (and is retried if it ever failed), independent of loudness;
// v10 adds lightweight local playback history for Home; v11 (M5) adds remote
// sources (Subsonic/Jellyfin): a `remote_sources` table + remote-linkage columns on
// `tracks`, and makes `folder_id` nullable (remote tracks have no SAF folder); v12
// marks playlists that mirror a server playlist (remote_source_id/remote_playlist_id)
// so remote playlist sync can upsert + reconcile them; v13 adds `remote_sources.art_auth`
// — a self-contained cover-art URL template the native Android Auto artwork provider uses
// to fetch server art without a JS round-trip; v14 adds desktop-style dynamic
// playlist rules plus fresh aggregate track play stats (no playback_history backfill);
// v15 adds `album_display_artist` — the settled group artist ("Various Artists" for
// shared-artwork compilations) written by the album-identity recompute pass
// (src/library/albumIdentity.ts); the backfill itself runs from libraryStore.initialize
// via the `album_grouping_version` settings sentinel (v3 precedent: SQL marks, store acts);
// v16 adds desktop LAN sync state (src/services/desktopSync.ts): a `sync_uid` playlist
// identity shared with the paired desktop, deletion tombstones for favorites/playlists,
// and a pending table for incoming favorites that haven't matched a local track yet;
// v17 adds `playlist_sync_state` — the per-playlist (local, remote) updated_at baseline
// from the last successful sync, which turns blind last-writer-wins into 3-way change
// detection: only-one-side-changed syncs silently, both-changed surfaces a conflict
// prompt (Steam-Cloud style) instead of silently dropping an edit; v18 adds `lyrics_cache`
// — LRC/XLRC results from online lookup (xlrcdb + lrclib), keyed by track_path with no FK
// (survives folder re-grant like waveform_peaks) and invalidated by a metadata_signature.

import type { LibraryDatabase } from './database';

export const SCHEMA_VERSION = 18;

// One statement per entry — op-sqlite executes single statements.
const MIGRATIONS: readonly (readonly string[])[] = [
  // v0 -> v1
  [
    `CREATE TABLE IF NOT EXISTS folders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tree_uri TEXT UNIQUE NOT NULL,
      display_name TEXT NOT NULL,
      added_at INTEGER NOT NULL,
      last_scanned_at INTEGER
    )`,
    `CREATE TABLE IF NOT EXISTS tracks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      path TEXT UNIQUE NOT NULL,
      folder_id INTEGER NOT NULL REFERENCES folders(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      artist TEXT NOT NULL,
      album TEXT NOT NULL,
      album_artist TEXT,
      album_identity_key TEXT NOT NULL,
      duration REAL NOT NULL DEFAULT 0,
      track_number INTEGER,
      disc_number INTEGER,
      year INTEGER,
      genre TEXT,
      artwork_hash TEXT,
      format TEXT NOT NULL,
      sample_rate INTEGER,
      bit_depth INTEGER,
      bitrate INTEGER,
      channels INTEGER,
      codec TEXT,
      source_type TEXT NOT NULL DEFAULT 'local',
      file_name TEXT NOT NULL,
      size INTEGER,
      mtime INTEGER NOT NULL DEFAULT 0,
      added_at INTEGER NOT NULL,
      modified_at INTEGER NOT NULL
    )`,
    'CREATE INDEX IF NOT EXISTS idx_tracks_album_identity ON tracks(album_identity_key)',
    'CREATE INDEX IF NOT EXISTS idx_tracks_artist ON tracks(artist)',
    'CREATE INDEX IF NOT EXISTS idx_tracks_folder ON tracks(folder_id)',
  ],
  // v1 -> v2 — playlists + favorites (desktop library.ts tables, trimmed).
  // track_path deliberately has NO FK to tracks: entries survive folder removal
  // and resolve again when the same folder is re-granted (identical SAF URIs).
  [
    `CREATE TABLE IF NOT EXISTS playlists (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      last_played_at INTEGER
    )`,
    `CREATE TABLE IF NOT EXISTS playlist_tracks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      playlist_id INTEGER NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
      track_path TEXT NOT NULL,
      position INTEGER NOT NULL,
      added_at INTEGER NOT NULL,
      fallback_title TEXT,
      fallback_artist TEXT,
      fallback_album TEXT,
      UNIQUE(playlist_id, track_path)
    )`,
    'CREATE INDEX IF NOT EXISTS idx_playlist_tracks_playlist ON playlist_tracks(playlist_id, position)',
    `CREATE TABLE IF NOT EXISTS favorites (
      track_path TEXT PRIMARY KEY NOT NULL,
      added_at INTEGER NOT NULL
    )`,
  ],
  // v2 -> v3 — pre-fix builds stored truncated non-ASCII tags (op-sqlite bind bug,
  // see database.ts). The damage is irreversible in place, so mark every track
  // stale; libraryStore re-extracts them on next launch now that binding is fixed.
  [`UPDATE tracks SET mtime = -1`],
  // v3 -> v4 — persisted app preferences as a simple key-value store.
  [
    `CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY NOT NULL,
      value TEXT NOT NULL
    )`,
  ],
  // v4 -> v5 — cached waveform peaks (offline RMS bins) for the seek bar.
  // Keyed by track path (SAF URI), no FK — survives folder removal/re-grant
  // like favorites/playlists. `peaks` is a tightly-packed Float32 LE blob.
  [
    `CREATE TABLE IF NOT EXISTS waveform_peaks (
      track_path TEXT PRIMARY KEY NOT NULL,
      bins INTEGER NOT NULL,
      peaks BLOB NOT NULL,
      created_at INTEGER NOT NULL
    )`,
  ],
  // v5 -> v6 — repair: an abandoned earlier M3 spike shipped a v5 that created a
  // different `waveform_cache` table, leaving such DBs at v5 without the
  // `waveform_peaks` table above. Create it if missing and drop the orphan.
  [
    `CREATE TABLE IF NOT EXISTS waveform_peaks (
      track_path TEXT PRIMARY KEY NOT NULL,
      bins INTEGER NOT NULL,
      peaks BLOB NOT NULL,
      created_at INTEGER NOT NULL
    )`,
    `DROP TABLE IF EXISTS waveform_cache`,
  ],
  // v6 -> v7 — per-track loudness facts for normalization (M4). NULL = not yet
  // analyzed (the scan analyze pass / lazy fallback backfills them). loudness_lufs
  // is integrated LUFS (negative dB); sample_peak is linear [0,1]; replay_gain_*
  // are tag dB values when present.
  [
    `ALTER TABLE tracks ADD COLUMN loudness_lufs REAL`,
    `ALTER TABLE tracks ADD COLUMN sample_peak REAL`,
    `ALTER TABLE tracks ADD COLUMN replay_gain_track_db REAL`,
    `ALTER TABLE tracks ADD COLUMN replay_gain_album_db REAL`,
  ],
  // v7 -> v8 — re-measure loudness with the gated subset method (the earlier values
  // were ungated whole-file). NULL forces the background pass to recompute them.
  [`UPDATE tracks SET loudness_lufs = NULL, sample_peak = NULL`],
  // v8 -> v9 — ReplayGain peaks (linear, for clip-limiting in RG mode) + an
  // `rg_scanned` flag (0 = tags not yet read). Tag reading is decoupled from the
  // loudness decode so it runs once per track and survives loudness re-measures.
  [
    `ALTER TABLE tracks ADD COLUMN replay_gain_track_peak REAL`,
    `ALTER TABLE tracks ADD COLUMN replay_gain_album_peak REAL`,
    `ALTER TABLE tracks ADD COLUMN rg_scanned INTEGER NOT NULL DEFAULT 0`,
  ],
  // v9 -> v10 — recently played facts. No FK so rows can survive temporary
  // folder removal; Home joins against tracks so missing files stay hidden.
  [
    `CREATE TABLE IF NOT EXISTS playback_history (
      track_path TEXT PRIMARY KEY NOT NULL,
      last_played_at INTEGER NOT NULL,
      play_count INTEGER NOT NULL DEFAULT 1
    )`,
    'CREATE INDEX IF NOT EXISTS idx_playback_history_last_played ON playback_history(last_played_at DESC)',
  ],
  // v10 -> v11 — remote sources (M5: Subsonic/Jellyfin). One `remote_sources` table
  // (type-discriminated) holds server config + cached Jellyfin auth (the password
  // lives in expo-secure-store, never here). The `tracks` table gains remote-linkage
  // columns and `folder_id` becomes nullable — SQLite can't drop NOT NULL in place,
  // so we rebuild `tracks` (the only FK into it is its own folder_id; favorites /
  // playlists / waveform_peaks / playback_history key on `path` with no FK, so the
  // rebuild is safe). Existing (local) rows copy across; the 4 new columns default NULL.
  [
    `CREATE TABLE IF NOT EXISTS remote_sources (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL,
      name TEXT NOT NULL,
      base_url TEXT NOT NULL,
      username TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      last_status TEXT NOT NULL DEFAULT 'unknown',
      last_error TEXT,
      last_sync_at INTEGER,
      last_checked_at INTEGER,
      access_token TEXT,
      user_id TEXT,
      device_id TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )`,
    `CREATE TABLE tracks_new (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      path TEXT UNIQUE NOT NULL,
      folder_id INTEGER REFERENCES folders(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      artist TEXT NOT NULL,
      album TEXT NOT NULL,
      album_artist TEXT,
      album_identity_key TEXT NOT NULL,
      duration REAL NOT NULL DEFAULT 0,
      track_number INTEGER,
      disc_number INTEGER,
      year INTEGER,
      genre TEXT,
      artwork_hash TEXT,
      format TEXT NOT NULL,
      sample_rate INTEGER,
      bit_depth INTEGER,
      bitrate INTEGER,
      channels INTEGER,
      codec TEXT,
      source_type TEXT NOT NULL DEFAULT 'local',
      file_name TEXT NOT NULL,
      size INTEGER,
      mtime INTEGER NOT NULL DEFAULT 0,
      added_at INTEGER NOT NULL,
      modified_at INTEGER NOT NULL,
      loudness_lufs REAL,
      sample_peak REAL,
      replay_gain_track_db REAL,
      replay_gain_album_db REAL,
      replay_gain_track_peak REAL,
      replay_gain_album_peak REAL,
      rg_scanned INTEGER NOT NULL DEFAULT 0,
      source_id INTEGER,
      source_track_id TEXT,
      source_path TEXT,
      artwork_source_id TEXT
    )`,
    `INSERT INTO tracks_new (
      id, path, folder_id, title, artist, album, album_artist, album_identity_key,
      duration, track_number, disc_number, year, genre, artwork_hash, format,
      sample_rate, bit_depth, bitrate, channels, codec, source_type, file_name, size,
      mtime, added_at, modified_at, loudness_lufs, sample_peak, replay_gain_track_db,
      replay_gain_album_db, replay_gain_track_peak, replay_gain_album_peak, rg_scanned
    )
    SELECT
      id, path, folder_id, title, artist, album, album_artist, album_identity_key,
      duration, track_number, disc_number, year, genre, artwork_hash, format,
      sample_rate, bit_depth, bitrate, channels, codec, source_type, file_name, size,
      mtime, added_at, modified_at, loudness_lufs, sample_peak, replay_gain_track_db,
      replay_gain_album_db, replay_gain_track_peak, replay_gain_album_peak, rg_scanned
    FROM tracks`,
    `DROP TABLE tracks`,
    `ALTER TABLE tracks_new RENAME TO tracks`,
    'CREATE INDEX IF NOT EXISTS idx_tracks_album_identity ON tracks(album_identity_key)',
    'CREATE INDEX IF NOT EXISTS idx_tracks_artist ON tracks(artist)',
    'CREATE INDEX IF NOT EXISTS idx_tracks_folder ON tracks(folder_id)',
    'CREATE INDEX IF NOT EXISTS idx_tracks_source ON tracks(source_type, source_id)',
  ],
  // v11 -> v12 — mark playlists that mirror a remote server playlist. A non-null
  // remote_source_id (-> remote_sources.id) + remote_playlist_id make the row a synced
  // remote playlist; the unique index lets sync upsert by that pair. Local playlists
  // leave both NULL and are untouched.
  [
    `ALTER TABLE playlists ADD COLUMN remote_source_id INTEGER`,
    `ALTER TABLE playlists ADD COLUMN remote_playlist_id TEXT`,
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_playlists_remote
       ON playlists(remote_source_id, remote_playlist_id)
       WHERE remote_source_id IS NOT NULL AND remote_playlist_id IS NOT NULL`,
  ],
  // v12 -> v13 — cover-art URL template per remote source, read by the native Android
  // Auto artwork provider (which has no JS/secret access) to fetch + cache server art.
  // It embeds a fixed Subsonic salt+token / Jellyfin api_key with an `__ASTRA_ART_ID__`
  // placeholder for the cover id; the password itself never leaves expo-secure-store.
  [`ALTER TABLE remote_sources ADD COLUMN art_auth TEXT`],
  // v13 -> v14 — dynamic playlists and fresh aggregate play stats. Do not seed
  // play_count / last_played_at from playback_history: existing recents remain for
  // Home, while dynamic play-stat rules start fresh from this version forward.
  [
    `ALTER TABLE tracks ADD COLUMN play_count INTEGER NOT NULL DEFAULT 0`,
    `ALTER TABLE tracks ADD COLUMN last_played_at INTEGER`,
    `ALTER TABLE tracks ADD COLUMN bpm REAL`,
    `ALTER TABLE tracks ADD COLUMN musical_key TEXT`,
    `ALTER TABLE playlists ADD COLUMN kind TEXT NOT NULL DEFAULT 'normal'`,
    `ALTER TABLE playlists ADD COLUMN dynamic_rules_json TEXT`,
    `UPDATE playlists SET kind = 'normal' WHERE kind IS NULL OR kind NOT IN ('normal', 'dynamic')`,
    `UPDATE playlists SET dynamic_rules_json = NULL WHERE kind <> 'dynamic'`,
    `CREATE INDEX IF NOT EXISTS idx_tracks_play_count ON tracks(play_count DESC)`,
    `CREATE INDEX IF NOT EXISTS idx_tracks_last_played ON tracks(last_played_at DESC)`,
    `CREATE INDEX IF NOT EXISTS idx_playlists_kind ON playlists(kind)`,
  ],
  // v14 -> v15 — settled album display artist (see header). NULL until the
  // startup recompute pass backfills it; readers fall back to album_artist/artist.
  [`ALTER TABLE tracks ADD COLUMN album_display_artist TEXT`],
  // v15 -> v16 — desktop LAN sync (see header). Tombstones record deletions so a
  // two-way merge propagates them instead of resurrecting the row from the peer;
  // favorite_sync_pending holds incoming favorites with no local track match yet
  // (retried against the metadata ladder at each sync). Table shapes mirror the
  // desktop's (astra src/main/services/library.ts).
  [
    `ALTER TABLE playlists ADD COLUMN sync_uid TEXT`,
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_playlists_sync_uid
       ON playlists(sync_uid)
       WHERE sync_uid IS NOT NULL`,
    `CREATE TABLE IF NOT EXISTS favorite_tombstones (
      sync_key TEXT PRIMARY KEY NOT NULL,
      deleted_at INTEGER NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS favorite_sync_pending (
      sync_key TEXT PRIMARY KEY NOT NULL,
      title TEXT NOT NULL,
      artist TEXT NOT NULL,
      album TEXT NOT NULL,
      added_at INTEGER NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS playlist_tombstones (
      sync_uid TEXT PRIMARY KEY NOT NULL,
      deleted_at INTEGER NOT NULL
    )`,
  ],
  // v16 -> v17 — desktop sync conflict detection baseline (see header). Rows are
  // written only for playlists that ended a sync run in-sync on both devices.
  [
    `CREATE TABLE IF NOT EXISTS playlist_sync_state (
      sync_uid TEXT PRIMARY KEY NOT NULL,
      local_updated_at INTEGER NOT NULL,
      remote_updated_at INTEGER NOT NULL
    )`,
  ],
  // v17 -> v18 — cached lyrics (LRC/XLRC) from online lookup (xlrcdb + lrclib).
  // Keyed by track_path (SAF URI / remote identity), no FK — survives folder
  // removal/re-grant like waveform_peaks. metadata_signature (sha1 of
  // title/artist/album/duration) invalidates the row when the track's tags change;
  // `status` distinguishes a real hit from a cached "no lyrics found" (so we don't
  // re-hit the network every open); synced_lines_json is the parsed LyricsLine[] the
  // renderer consumes. Non-ASCII lyric text stores via the op-sqlite UTF-8/Latin1
  // param workaround (see database.ts). Local/embedded sources land in the v2 phase.
  [
    `CREATE TABLE IF NOT EXISTS lyrics_cache (
      track_path TEXT PRIMARY KEY NOT NULL,
      metadata_signature TEXT,
      status TEXT NOT NULL,
      source TEXT,
      provider TEXT,
      format TEXT,
      plain_lyrics TEXT,
      synced_lyrics TEXT,
      synced_lines_json TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    )`,
    'CREATE INDEX IF NOT EXISTS idx_lyrics_cache_updated ON lyrics_cache(updated_at)',
  ],
];

export async function migrate(db: LibraryDatabase): Promise<void> {
  const row = await db.get<{ user_version: number }>('PRAGMA user_version');
  const current = row?.user_version ?? 0;

  for (let version = current; version < SCHEMA_VERSION; version++) {
    await db.transaction(async (tx) => {
      for (const statement of MIGRATIONS[version]) {
        await tx.exec(statement);
      }
      await tx.exec(`PRAGMA user_version = ${version + 1}`);
    });
  }
}

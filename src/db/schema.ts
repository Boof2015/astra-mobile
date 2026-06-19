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
// v10 adds lightweight local playback history for Home.

import type { LibraryDatabase } from './database';

export const SCHEMA_VERSION = 10;

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

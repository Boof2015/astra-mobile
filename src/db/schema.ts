// Library schema — a trimmed port of the desktop schema (astra
// src/main/services/library.ts). v1 covers M1 (local scan + browse);
// v2 adds playlists + favorites (M2); v3 forces re-extraction of tracks whose
// non-ASCII tags were truncated by the pre-fix op-sqlite binding (see database.ts).

import type { LibraryDatabase } from './database';

export const SCHEMA_VERSION = 3;

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

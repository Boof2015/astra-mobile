// Library schema — a trimmed port of the desktop schema (astra
// src/main/services/library.ts). v1 covers M1 (local scan + browse);
// playlists arrive as v2 at M2, metadata overrides / lyrics later.

import type { LibraryDatabase } from './database';

export const SCHEMA_VERSION = 1;

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

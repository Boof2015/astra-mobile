// Library queries — SQL ported/adapted from the desktop library service.

import type { Album, DbTrack, LibraryFolder } from '@/types/library';
import type { LibraryDatabase, SqlParams } from './database';

/** Row shape the scanner produces for insert/update (id and timestamps are db-managed). */
export interface TrackUpsert {
  path: string;
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
  file_name: string;
  size: number | null;
  mtime: number;
}

const UPSERT_TRACK_SQL = `
  INSERT INTO tracks (
    path, folder_id, title, artist, album, album_artist, album_identity_key,
    duration, track_number, disc_number, year, genre, artwork_hash, format,
    sample_rate, bit_depth, bitrate, channels, codec, source_type,
    file_name, size, mtime, added_at, modified_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'local', ?, ?, ?, ?, ?)
  ON CONFLICT(path) DO UPDATE SET
    folder_id = excluded.folder_id,
    title = excluded.title,
    artist = excluded.artist,
    album = excluded.album,
    album_artist = excluded.album_artist,
    album_identity_key = excluded.album_identity_key,
    duration = excluded.duration,
    track_number = excluded.track_number,
    disc_number = excluded.disc_number,
    year = excluded.year,
    genre = excluded.genre,
    artwork_hash = excluded.artwork_hash,
    format = excluded.format,
    sample_rate = excluded.sample_rate,
    bit_depth = excluded.bit_depth,
    bitrate = excluded.bitrate,
    channels = excluded.channels,
    codec = excluded.codec,
    file_name = excluded.file_name,
    size = excluded.size,
    mtime = excluded.mtime,
    modified_at = excluded.modified_at
`;

export async function upsertTracks(db: LibraryDatabase, rows: TrackUpsert[]): Promise<void> {
  if (rows.length === 0) return;
  const now = Date.now();
  await db.transaction(async (tx) => {
    for (const row of rows) {
      await tx.run(UPSERT_TRACK_SQL, [
        row.path,
        row.folder_id,
        row.title,
        row.artist,
        row.album,
        row.album_artist,
        row.album_identity_key,
        row.duration,
        row.track_number,
        row.disc_number,
        row.year,
        row.genre,
        row.artwork_hash,
        row.format,
        row.sample_rate,
        row.bit_depth,
        row.bitrate,
        row.channels,
        row.codec,
        row.file_name,
        row.size,
        row.mtime,
        now,
        now,
      ]);
    }
  });
}

// --- Remote tracks (Subsonic / Jellyfin) -------------------------------------

/** Row shape for a synced remote track. folder_id is NULL; file_name/size/mtime unused. */
export interface RemoteTrackUpsert {
  path: string; // subsonic://|jellyfin:// identity URI
  source_type: 'subsonic' | 'jellyfin';
  source_id: number;
  source_track_id: string;
  source_path: string | null;
  artwork_source_id: string | null;
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
  format: string;
  sample_rate: number | null;
  bit_depth: number | null;
  bitrate: number | null;
  channels: number | null;
  codec: string | null;
}

const UPSERT_REMOTE_TRACK_SQL = `
  INSERT INTO tracks (
    path, folder_id, title, artist, album, album_artist, album_identity_key,
    duration, track_number, disc_number, year, genre, artwork_hash, format,
    sample_rate, bit_depth, bitrate, channels, codec, source_type, source_id,
    source_track_id, source_path, artwork_source_id, file_name, size, mtime,
    added_at, modified_at
  ) VALUES (?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '', NULL, 0, ?, ?)
  ON CONFLICT(path) DO UPDATE SET
    title = excluded.title,
    artist = excluded.artist,
    album = excluded.album,
    album_artist = excluded.album_artist,
    album_identity_key = excluded.album_identity_key,
    duration = excluded.duration,
    track_number = excluded.track_number,
    disc_number = excluded.disc_number,
    year = excluded.year,
    genre = excluded.genre,
    format = excluded.format,
    sample_rate = excluded.sample_rate,
    bit_depth = excluded.bit_depth,
    bitrate = excluded.bitrate,
    channels = excluded.channels,
    codec = excluded.codec,
    source_track_id = excluded.source_track_id,
    source_path = excluded.source_path,
    artwork_source_id = excluded.artwork_source_id,
    modified_at = excluded.modified_at
`;

export async function upsertRemoteTracks(
  db: LibraryDatabase,
  rows: RemoteTrackUpsert[]
): Promise<void> {
  if (rows.length === 0) return;
  const now = Date.now();
  await db.transaction(async (tx) => {
    for (const row of rows) {
      await tx.run(UPSERT_REMOTE_TRACK_SQL, [
        row.path,
        row.title,
        row.artist,
        row.album,
        row.album_artist,
        row.album_identity_key,
        row.duration,
        row.track_number,
        row.disc_number,
        row.year,
        row.genre,
        row.format,
        row.sample_rate,
        row.bit_depth,
        row.bitrate,
        row.channels,
        row.codec,
        row.source_type,
        row.source_id,
        row.source_track_id,
        row.source_path,
        row.artwork_source_id,
        now,
        now,
      ]);
    }
  });
}

/** Existing remote-track paths for a source, used to diff/prune removed tracks. */
export function getRemoteSourcePaths(
  db: LibraryDatabase,
  sourceType: string,
  sourceId: number
): Promise<{ path: string }[]> {
  return db.all<{ path: string }>(
    'SELECT path FROM tracks WHERE source_type = ? AND source_id = ?',
    [sourceType, sourceId]
  );
}

export async function deleteRemoteTracksBySource(
  db: LibraryDatabase,
  sourceType: string,
  sourceId: number
): Promise<number> {
  const result = await db.run('DELETE FROM tracks WHERE source_type = ? AND source_id = ?', [
    sourceType,
    sourceId,
  ]);
  return result.changes;
}

const TRACK_ORDER = 'COALESCE(disc_number, 9999), COALESCE(track_number, 9999), title COLLATE NOCASE';

export function getAlbums(db: LibraryDatabase): Promise<Album[]> {
  return db.all<Album>(`
    SELECT album_identity_key AS identity_key,
           MAX(album) AS album,
           MAX(COALESCE(album_artist, artist)) AS artist,
           MAX(year) AS year,
           MAX(artwork_hash) AS artwork_hash,
           COUNT(*) AS track_count,
           MAX(added_at) AS latest_added_at,
           MAX(source_type) AS source_type,
           MAX(source_id) AS source_id,
           MAX(artwork_source_id) AS artwork_source_id
    FROM tracks
    GROUP BY album_identity_key
    ORDER BY 3 COLLATE NOCASE, 2 COLLATE NOCASE
  `);
}

// NOTE: the artist browse list is built in JS (src/library/artistGrouping.ts) so it
// can honor the astra-grouping vs file-tags mode; there is no SQL getArtists anymore.

export function getAllTracks(db: LibraryDatabase): Promise<DbTrack[]> {
  return db.all<DbTrack>(`
    SELECT * FROM tracks
    ORDER BY artist COLLATE NOCASE, album COLLATE NOCASE, ${TRACK_ORDER}
  `);
}

export function getTracksByAlbumKey(db: LibraryDatabase, identityKey: string): Promise<DbTrack[]> {
  return db.all<DbTrack>(
    `SELECT * FROM tracks WHERE album_identity_key = ? ORDER BY ${TRACK_ORDER}`,
    [identityKey]
  );
}

export function getTracksByArtist(db: LibraryDatabase, artist: string): Promise<DbTrack[]> {
  return db.all<DbTrack>(
    `SELECT * FROM tracks WHERE artist = ? ORDER BY album COLLATE NOCASE, ${TRACK_ORDER}`,
    [artist]
  );
}

export async function getTrackCount(db: LibraryDatabase): Promise<number> {
  const row = await db.get<{ count: number }>('SELECT COUNT(*) AS count FROM tracks');
  return row?.count ?? 0;
}

// --- Playback history --------------------------------------------------------

/**
 * Record a local library play. The INSERT is sourced from `tracks`, so streamed
 * samples / external paths are ignored unless they are actually in the library.
 */
export async function markTrackPlayed(db: LibraryDatabase, path: string): Promise<boolean> {
  const result = await db.run(
    `INSERT INTO playback_history (track_path, last_played_at, play_count)
       SELECT path, ?, 1 FROM tracks WHERE path = ?
     ON CONFLICT(track_path) DO UPDATE SET
       last_played_at = excluded.last_played_at,
       play_count = playback_history.play_count + 1`,
    [Date.now(), path]
  );
  return result.changes > 0;
}

export function getRecentlyPlayedTracks(
  db: LibraryDatabase,
  limit = 24
): Promise<DbTrack[]> {
  return db.all<DbTrack>(
    `SELECT t.* FROM playback_history h
     JOIN tracks t ON t.path = h.track_path
     ORDER BY h.last_played_at DESC
     LIMIT ?`,
    [limit]
  );
}

// --- Loudness (M4 normalization facts) ---------------------------------------

export interface TrackLoudness {
  loudness_lufs: number | null;
  sample_peak: number | null;
  replay_gain_track_db: number | null;
  replay_gain_album_db: number | null;
  replay_gain_track_peak: number | null;
  replay_gain_album_peak: number | null;
  /** 1 once ReplayGain tags have been read (whether or not any were present). */
  rg_scanned: number | null;
}

/** Loudness facts for one track path (NULL fields = not yet analyzed). */
export async function getTrackLoudness(
  db: LibraryDatabase,
  path: string
): Promise<TrackLoudness | null> {
  return (
    (await db.get<TrackLoudness>(
      `SELECT loudness_lufs, sample_peak,
              replay_gain_track_db, replay_gain_album_db,
              replay_gain_track_peak, replay_gain_album_peak, rg_scanned
       FROM tracks WHERE path = ?`,
      [path]
    )) ?? null
  );
}

/** Persist measured loudness + sample peak for a track (scan analyze pass). */
export async function setTrackLoudness(
  db: LibraryDatabase,
  path: string,
  lufs: number | null,
  samplePeak: number | null
): Promise<void> {
  await db.run('UPDATE tracks SET loudness_lufs = ?, sample_peak = ? WHERE path = ?', [
    lufs,
    samplePeak,
    path,
  ]);
}

export interface ReplayGainColumns {
  trackGainDb: number | null;
  albumGainDb: number | null;
  trackPeak: number | null;
  albumPeak: number | null;
}

/**
 * Persist ReplayGain tags read from the container + mark the track as scanned, so
 * we read tags once per track (independent of loudness, which may re-measure).
 */
export async function setTrackReplayGain(
  db: LibraryDatabase,
  path: string,
  rg: ReplayGainColumns
): Promise<void> {
  await db.run(
    `UPDATE tracks SET
       replay_gain_track_db = ?, replay_gain_album_db = ?,
       replay_gain_track_peak = ?, replay_gain_album_peak = ?, rg_scanned = 1
     WHERE path = ?`,
    [rg.trackGainDb, rg.albumGainDb, rg.trackPeak, rg.albumPeak, path]
  );
}

// --- Settings (key-value preferences) ----------------------------------------

export async function getSetting(db: LibraryDatabase, key: string): Promise<string | null> {
  const row = await db.get<{ value: string }>('SELECT value FROM settings WHERE key = ?', [key]);
  return row?.value ?? null;
}

export async function setSetting(db: LibraryDatabase, key: string, value: string): Promise<void> {
  await db.run(
    `INSERT INTO settings (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    [key, value]
  );
}

// --- Folders -----------------------------------------------------------------

type FolderRow = Omit<LibraryFolder, 'available'>;

export function getFolders(db: LibraryDatabase): Promise<FolderRow[]> {
  return db.all<FolderRow>('SELECT * FROM folders ORDER BY added_at');
}

export async function getFolderTrackCounts(db: LibraryDatabase): Promise<Map<number, number>> {
  const rows = await db.all<{ folder_id: number; count: number }>(
    'SELECT folder_id, COUNT(*) AS count FROM tracks GROUP BY folder_id'
  );
  return new Map(rows.map((row) => [row.folder_id, row.count]));
}

export async function insertFolder(
  db: LibraryDatabase,
  treeUri: string,
  displayName: string
): Promise<FolderRow> {
  await db.run(
    `INSERT INTO folders (tree_uri, display_name, added_at) VALUES (?, ?, ?)
     ON CONFLICT(tree_uri) DO UPDATE SET display_name = excluded.display_name`,
    [treeUri, displayName, Date.now()]
  );
  const row = await db.get<FolderRow>('SELECT * FROM folders WHERE tree_uri = ?', [treeUri]);
  if (!row) throw new Error('Folder insert failed');
  return row;
}

export async function deleteFolder(db: LibraryDatabase, folderId: number): Promise<void> {
  // ON DELETE CASCADE removes the folder's tracks (foreign_keys is ON per connection).
  await db.run('DELETE FROM folders WHERE id = ?', [folderId]);
}

export async function markFolderScanned(db: LibraryDatabase, folderId: number): Promise<void> {
  await db.run('UPDATE folders SET last_scanned_at = ? WHERE id = ?', [Date.now(), folderId]);
}

// --- Scan support ------------------------------------------------------------

export function getFolderSyncRows(
  db: LibraryDatabase,
  folderId: number
): Promise<{ path: string; size: number | null; mtime: number }[]> {
  return db.all('SELECT path, size, mtime FROM tracks WHERE folder_id = ?', [folderId]);
}

export async function deleteTracksByPaths(db: LibraryDatabase, paths: string[]): Promise<number> {
  let deleted = 0;
  for (let i = 0; i < paths.length; i += 500) {
    const chunk = paths.slice(i, i + 500);
    const placeholders = chunk.map(() => '?').join(', ');
    const result = await db.run(
      `DELETE FROM tracks WHERE path IN (${placeholders})`,
      chunk as SqlParams
    );
    deleted += result.changes;
  }
  return deleted;
}

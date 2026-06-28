// Playlist + favorites queries — SQL ported from the desktop library service
// (getPlaylists / addPlaylistEntries / removeFromPlaylist / favorites CRUD).

import type { DbTrack } from '@/types/library';
import type { Playlist, PlaylistTrackEntry } from '@/types/playlist';
import type { RemotePlaylist } from '@/types/remote';
import type { LibraryDatabase } from './database';

const PLAYLIST_SELECT = `
  SELECT p.id, p.name, p.created_at, p.updated_at, p.last_played_at, p.remote_source_id,
         (SELECT t.artwork_hash
            FROM playlist_tracks pt JOIN tracks t ON t.path = pt.track_path
           WHERE pt.playlist_id = p.id AND t.artwork_hash IS NOT NULL
           ORDER BY pt.position, pt.id LIMIT 1) AS auto_cover_hash,
         (SELECT COUNT(*)
            FROM playlist_tracks pt JOIN tracks t ON t.path = pt.track_path
           WHERE pt.playlist_id = p.id) AS track_count,
         (SELECT COUNT(*)
            FROM playlist_tracks pt LEFT JOIN tracks t ON t.path = pt.track_path
           WHERE pt.playlist_id = p.id AND t.path IS NULL) AS missing_track_count
  FROM playlists p
`;

export function getPlaylists(db: LibraryDatabase): Promise<Playlist[]> {
  return db.all<Playlist>(`
    ${PLAYLIST_SELECT}
    ORDER BY (p.last_played_at IS NULL), p.last_played_at DESC, p.updated_at DESC
  `);
}

export async function getPlaylist(db: LibraryDatabase, id: number): Promise<Playlist | undefined> {
  return db.get<Playlist>(`${PLAYLIST_SELECT} WHERE p.id = ?`, [id]);
}

export async function createPlaylist(db: LibraryDatabase, name: string): Promise<Playlist> {
  const now = Date.now();
  const result = await db.run(
    'INSERT INTO playlists (name, created_at, updated_at) VALUES (?, ?, ?)',
    [name, now, now]
  );
  const row = await getPlaylist(db, result.lastInsertRowid);
  if (!row) throw new Error('Playlist insert failed');
  return row;
}

export async function renamePlaylist(db: LibraryDatabase, id: number, name: string): Promise<void> {
  await db.run('UPDATE playlists SET name = ?, updated_at = ? WHERE id = ?', [
    name,
    Date.now(),
    id,
  ]);
}

export async function deletePlaylist(db: LibraryDatabase, id: number): Promise<void> {
  // ON DELETE CASCADE removes the entries (foreign_keys is ON per connection).
  await db.run('DELETE FROM playlists WHERE id = ?', [id]);
}

export async function markPlaylistPlayed(db: LibraryDatabase, id: number): Promise<void> {
  await db.run('UPDATE playlists SET last_played_at = ? WHERE id = ?', [Date.now(), id]);
}

// --- Entries -----------------------------------------------------------------

interface EntryRow extends Omit<DbTrack, 'id' | 'path' | 'added_at'> {
  entry_id: number;
  entry_track_path: string;
  entry_position: number;
  entry_added_at: number;
  fallback_title: string | null;
  fallback_artist: string | null;
  fallback_album: string | null;
  id: number | null;
  path: string | null;
  added_at: number | null;
}

export async function getPlaylistEntries(
  db: LibraryDatabase,
  playlistId: number
): Promise<PlaylistTrackEntry[]> {
  const rows = await db.all<EntryRow>(
    `SELECT pt.id AS entry_id, pt.track_path AS entry_track_path,
            pt.position AS entry_position, pt.added_at AS entry_added_at,
            pt.fallback_title, pt.fallback_artist, pt.fallback_album,
            t.*
     FROM playlist_tracks pt
     LEFT JOIN tracks t ON t.path = pt.track_path
     WHERE pt.playlist_id = ?
     ORDER BY pt.position, pt.id`,
    [playlistId]
  );
  return rows.map((row) => {
    const {
      entry_id,
      entry_track_path,
      entry_position,
      entry_added_at,
      fallback_title,
      fallback_artist,
      fallback_album,
      ...trackColumns
    } = row;
    const missing = trackColumns.path == null;
    return {
      id: entry_id,
      track_path: entry_track_path,
      position: entry_position,
      added_at: entry_added_at,
      missing,
      fallback_title,
      fallback_artist,
      fallback_album,
      track: missing ? null : (trackColumns as DbTrack),
    };
  });
}

export interface PlaylistEntryInsert {
  trackPath: string;
  fallbackTitle?: string | null;
  fallbackArtist?: string | null;
  fallbackAlbum?: string | null;
}

/** Appends entries (deduped against input and existing membership). Returns inserted count. */
export async function addPlaylistEntries(
  db: LibraryDatabase,
  playlistId: number,
  entries: PlaylistEntryInsert[]
): Promise<number> {
  if (entries.length === 0) return 0;
  let inserted = 0;
  await db.transaction(async (tx) => {
    const existing = await tx.all<{ track_path: string }>(
      'SELECT track_path FROM playlist_tracks WHERE playlist_id = ?',
      [playlistId]
    );
    const seen = new Set(existing.map((row) => row.track_path));
    const maxRow = await tx.get<{ max_position: number }>(
      'SELECT COALESCE(MAX(position), -1) AS max_position FROM playlist_tracks WHERE playlist_id = ?',
      [playlistId]
    );
    let position = maxRow?.max_position ?? -1;
    const now = Date.now();
    for (const entry of entries) {
      if (seen.has(entry.trackPath)) continue;
      seen.add(entry.trackPath);
      position += 1;
      await tx.run(
        `INSERT OR IGNORE INTO playlist_tracks
           (playlist_id, track_path, position, added_at, fallback_title, fallback_artist, fallback_album)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          playlistId,
          entry.trackPath,
          position,
          now,
          entry.fallbackTitle ?? null,
          entry.fallbackArtist ?? null,
          entry.fallbackAlbum ?? null,
        ]
      );
      inserted += 1;
    }
    if (inserted > 0) {
      await tx.run('UPDATE playlists SET updated_at = ? WHERE id = ?', [now, playlistId]);
    }
  });
  return inserted;
}

async function renormalizePositions(tx: LibraryDatabase, playlistId: number): Promise<void> {
  const rows = await tx.all<{ id: number }>(
    'SELECT id FROM playlist_tracks WHERE playlist_id = ? ORDER BY position, id',
    [playlistId]
  );
  for (let i = 0; i < rows.length; i++) {
    await tx.run('UPDATE playlist_tracks SET position = ? WHERE id = ?', [i, rows[i].id]);
  }
}

export async function removeFromPlaylist(
  db: LibraryDatabase,
  playlistId: number,
  trackPath: string
): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.run('DELETE FROM playlist_tracks WHERE playlist_id = ? AND track_path = ?', [
      playlistId,
      trackPath,
    ]);
    await renormalizePositions(tx, playlistId);
    await tx.run('UPDATE playlists SET updated_at = ? WHERE id = ?', [Date.now(), playlistId]);
  });
}

/** Swaps the entry with its neighbor above (-1) or below (+1); no-op at list edges. */
export async function movePlaylistTrack(
  db: LibraryDatabase,
  playlistId: number,
  trackPath: string,
  direction: -1 | 1
): Promise<void> {
  await db.transaction(async (tx) => {
    const row = await tx.get<{ id: number; position: number }>(
      'SELECT id, position FROM playlist_tracks WHERE playlist_id = ? AND track_path = ?',
      [playlistId, trackPath]
    );
    if (!row) return;
    const neighbor = await tx.get<{ id: number; position: number }>(
      direction === -1
        ? 'SELECT id, position FROM playlist_tracks WHERE playlist_id = ? AND position < ? ORDER BY position DESC LIMIT 1'
        : 'SELECT id, position FROM playlist_tracks WHERE playlist_id = ? AND position > ? ORDER BY position ASC LIMIT 1',
      [playlistId, row.position]
    );
    if (!neighbor) return;
    await tx.run('UPDATE playlist_tracks SET position = ? WHERE id = ?', [neighbor.position, row.id]);
    await tx.run('UPDATE playlist_tracks SET position = ? WHERE id = ?', [row.position, neighbor.id]);
    await tx.run('UPDATE playlists SET updated_at = ? WHERE id = ?', [Date.now(), playlistId]);
  });
}

// --- Favorites ---------------------------------------------------------------

export function getFavoriteTracks(db: LibraryDatabase): Promise<DbTrack[]> {
  return db.all<DbTrack>(`
    SELECT t.* FROM favorites f
    JOIN tracks t ON t.path = f.track_path
    ORDER BY f.added_at DESC
  `);
}

export async function getFavoritePaths(db: LibraryDatabase): Promise<string[]> {
  const rows = await db.all<{ track_path: string }>('SELECT track_path FROM favorites');
  return rows.map((row) => row.track_path);
}

export async function addFavorite(db: LibraryDatabase, trackPath: string): Promise<void> {
  await db.run('INSERT OR IGNORE INTO favorites (track_path, added_at) VALUES (?, ?)', [
    trackPath,
    Date.now(),
  ]);
}

export async function removeFavorite(db: LibraryDatabase, trackPath: string): Promise<void> {
  await db.run('DELETE FROM favorites WHERE track_path = ?', [trackPath]);
}

/** Add many favorites at once (insert-or-ignore). Used by remote starred sync. */
export async function addFavoritePaths(db: LibraryDatabase, paths: string[]): Promise<void> {
  if (paths.length === 0) return;
  const now = Date.now();
  await db.transaction(async (tx) => {
    for (const path of paths) {
      await tx.run('INSERT OR IGNORE INTO favorites (track_path, added_at) VALUES (?, ?)', [
        path,
        now,
      ]);
    }
  });
}

// --- Remote sync (Subsonic playlists/favorites) ------------------------------

/** Remove favorites whose path belongs to a given remote source (on source delete). */
export async function deleteFavoritesByPathPrefix(
  db: LibraryDatabase,
  prefix: string
): Promise<void> {
  await db.run('DELETE FROM favorites WHERE track_path LIKE ?', [`${prefix}%`]);
}

/** Remove all synced playlists (and their entries via CASCADE) for a remote source. */
export async function deleteRemotePlaylistsBySource(
  db: LibraryDatabase,
  sourceId: number
): Promise<void> {
  await db.run('DELETE FROM playlists WHERE remote_source_id = ?', [sourceId]);
}

/**
 * Upsert a source's server playlists by (remote_source_id, remote_playlist_id):
 * create/update each + replace its entries, then delete remote playlists for this
 * source that vanished upstream. Ports desktop `syncSubsonicRemotePlaylists`.
 */
export async function syncRemotePlaylists(
  db: LibraryDatabase,
  sourceId: number,
  playlists: RemotePlaylist[]
): Promise<void> {
  await db.transaction(async (tx) => {
    const existing = await tx.all<{ id: number; remote_playlist_id: string }>(
      'SELECT id, remote_playlist_id FROM playlists WHERE remote_source_id = ?',
      [sourceId]
    );
    const existingByRemoteId = new Map<string, number>();
    for (const row of existing) {
      if (row.remote_playlist_id) existingByRemoteId.set(row.remote_playlist_id, row.id);
    }

    const seen = new Set<string>();
    const now = Date.now();
    for (const playlist of playlists) {
      const remotePlaylistId = playlist.source_playlist_id.trim();
      if (!remotePlaylistId) continue;
      seen.add(remotePlaylistId);
      const name = playlist.name.trim() || `Playlist ${remotePlaylistId}`;

      let playlistId = existingByRemoteId.get(remotePlaylistId);
      if (playlistId == null) {
        const result = await tx.run(
          `INSERT INTO playlists (name, created_at, updated_at, remote_source_id, remote_playlist_id)
           VALUES (?, ?, ?, ?, ?)`,
          [name, now, now, sourceId, remotePlaylistId]
        );
        playlistId = result.lastInsertRowid;
      } else {
        await tx.run('UPDATE playlists SET name = ?, updated_at = ? WHERE id = ?', [
          name,
          now,
          playlistId,
        ]);
        await tx.run('DELETE FROM playlist_tracks WHERE playlist_id = ?', [playlistId]);
      }

      let position = 0;
      const seenPaths = new Set<string>();
      for (const track of playlist.tracks) {
        if (seenPaths.has(track.path)) continue;
        seenPaths.add(track.path);
        await tx.run(
          `INSERT OR IGNORE INTO playlist_tracks
             (playlist_id, track_path, position, added_at, fallback_title, fallback_artist, fallback_album)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [playlistId, track.path, position++, now, track.title, track.artist, track.album]
        );
      }
    }

    // Reconcile: drop synced playlists that no longer exist upstream.
    for (const [remoteId, playlistId] of existingByRemoteId) {
      if (seen.has(remoteId)) continue;
      await tx.run('DELETE FROM playlists WHERE id = ?', [playlistId]);
    }
  });
}

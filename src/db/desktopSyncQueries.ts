// Mobile-side DB surface for the desktop LAN sync (src/services/desktopSync.ts).
// Serializes local favorites/playlists into the shared wire vocabulary and
// applies merged results. Apply-variants deliberately use the caller-supplied
// (source) timestamps and never write tombstones for the rows they touch —
// otherwise an applied change would look like a fresh local edit on the next
// sync and ping-pong between devices.

import { buildTrackSyncKey, normalizeSyncKeyPart } from '@/shared/sync/identity';
import { normalizeDynamicPlaylistRules } from '@/shared/playlists/dynamicPlaylist';
import { randomSaltHex } from '@/lib/hash';
import type {
  SyncFavorite,
  SyncPlaylist,
  SyncPlaylistEntry,
  SyncPlaylistKind,
} from '@/types/desktopSync';
import type { LibraryDatabase } from './database';
import {
  decodedDocPath,
  matchSyncEntry,
  type ImportMatchIndex,
} from '@/library/playlistFiles';

export interface LocalSyncFavorite extends SyncFavorite {
  /** Local favorite rows carrying this identity (empty for pending rows). */
  trackPaths: string[];
  pending: boolean;
}

export interface LocalSyncPlaylist {
  id: number;
  syncUid: string;
  name: string;
  kind: SyncPlaylistKind;
  dynamicRules: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface LocalSyncState {
  favorites: Map<string, LocalSyncFavorite>;
  favoriteTombstones: Map<string, number>;
  playlists: LocalSyncPlaylist[];
  playlistTombstones: Map<string, number>;
}

/** Assign a sync identity to every sync-eligible playlist that lacks one.
 *  Assigning identity is not an edit: updated_at stays untouched. */
export async function ensurePlaylistSyncUids(db: LibraryDatabase): Promise<void> {
  const rows = await db.all<{ id: number }>(
    'SELECT id FROM playlists WHERE sync_uid IS NULL AND remote_source_id IS NULL'
  );
  for (const row of rows) {
    await db.run('UPDATE playlists SET sync_uid = ? WHERE id = ?', [randomSaltHex(16), row.id]);
  }
}

export async function getLocalSyncState(db: LibraryDatabase): Promise<LocalSyncState> {
  const favorites = new Map<string, LocalSyncFavorite>();
  const favoriteRows = await db.all<{
    track_path: string;
    added_at: number;
    title: string | null;
    artist: string | null;
    album: string | null;
  }>(`
    SELECT f.track_path, f.added_at, t.title, t.artist, t.album
    FROM favorites f
    LEFT JOIN tracks t ON t.path = f.track_path
  `);
  for (const row of favoriteRows) {
    // Orphaned favorites (no track row) have no metadata identity — skip.
    if (row.title == null || !normalizeSyncKeyPart(row.title)) continue;
    const key = buildTrackSyncKey(row.title, row.artist ?? '', row.album ?? '');
    const existing = favorites.get(key);
    if (existing) {
      existing.trackPaths.push(row.track_path);
      if (row.added_at > existing.addedAt) existing.addedAt = row.added_at;
    } else {
      favorites.set(key, {
        key,
        title: row.title,
        artist: row.artist ?? '',
        album: row.album ?? '',
        addedAt: row.added_at,
        trackPaths: [row.track_path],
        pending: false,
      });
    }
  }

  // Pending favorites re-enter sync state so they keep propagating even while
  // unresolved locally.
  const pendingRows = await db.all<{
    sync_key: string;
    title: string;
    artist: string;
    album: string;
    added_at: number;
  }>('SELECT sync_key, title, artist, album, added_at FROM favorite_sync_pending');
  for (const row of pendingRows) {
    if (favorites.has(row.sync_key)) continue;
    favorites.set(row.sync_key, {
      key: row.sync_key,
      title: row.title,
      artist: row.artist,
      album: row.album,
      addedAt: row.added_at,
      trackPaths: [],
      pending: true,
    });
  }

  const favoriteTombstones = new Map<string, number>();
  for (const row of await db.all<{ sync_key: string; deleted_at: number }>(
    'SELECT sync_key, deleted_at FROM favorite_tombstones'
  )) {
    favoriteTombstones.set(row.sync_key, row.deleted_at);
  }

  const playlists: LocalSyncPlaylist[] = [];
  for (const row of await db.all<{
    id: number;
    sync_uid: string;
    name: string;
    kind: string | null;
    dynamic_rules_json: string | null;
    created_at: number;
    updated_at: number;
  }>(`
    SELECT id, sync_uid, name, kind, dynamic_rules_json, created_at, updated_at
    FROM playlists
    WHERE sync_uid IS NOT NULL AND remote_source_id IS NULL
  `)) {
    const kind: SyncPlaylistKind = row.kind === 'dynamic' ? 'dynamic' : 'normal';
    playlists.push({
      id: row.id,
      syncUid: row.sync_uid,
      name: row.name,
      kind,
      dynamicRules: kind === 'dynamic' ? row.dynamic_rules_json : null,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    });
  }

  const playlistTombstones = new Map<string, number>();
  for (const row of await db.all<{ sync_uid: string; deleted_at: number }>(
    'SELECT sync_uid, deleted_at FROM playlist_tombstones'
  )) {
    playlistTombstones.set(row.sync_uid, row.deleted_at);
  }

  return { favorites, favoriteTombstones, playlists, playlistTombstones };
}

/** Serialize a normal playlist's entries for a push to the desktop. */
export async function getSyncPlaylistEntries(
  db: LibraryDatabase,
  playlistId: number
): Promise<SyncPlaylistEntry[]> {
  const rows = await db.all<{
    track_path: string;
    position: number;
    added_at: number;
    fallback_title: string | null;
    fallback_artist: string | null;
    fallback_album: string | null;
    title: string | null;
    artist: string | null;
    album: string | null;
    duration: number | null;
    file_name: string | null;
  }>(`
    SELECT pt.track_path, pt.position, pt.added_at,
           pt.fallback_title, pt.fallback_artist, pt.fallback_album,
           t.title, t.artist, t.album, t.duration, t.file_name
    FROM playlist_tracks pt
    LEFT JOIN tracks t ON t.path = pt.track_path
    WHERE pt.playlist_id = ?
    ORDER BY pt.position, pt.id
  `, [playlistId]);

  return rows.map((row) => ({
    title: row.title ?? row.fallback_title ?? '',
    artist: row.artist ?? row.fallback_artist ?? '',
    album: row.album ?? row.fallback_album ?? '',
    durationSeconds: typeof row.duration === 'number' && row.duration > 0 ? row.duration : null,
    position: row.position,
    addedAt: row.added_at,
    // The peer can only use trailing path segments; send the decoded SAF path
    // when the track exists locally, else pass the stored (foreign) path along.
    sourcePath: row.title != null
      ? (decodedDocPath(row.track_path) ?? row.file_name ?? null)
      : row.track_path || null,
  }));
}

export async function upsertPendingFavorite(db: LibraryDatabase, item: SyncFavorite): Promise<void> {
  await db.run(
    'INSERT OR REPLACE INTO favorite_sync_pending (sync_key, title, artist, album, added_at) VALUES (?, ?, ?, ?, ?)',
    [item.key, item.title, item.artist, item.album, item.addedAt]
  );
}

/** Retry pending favorites against the matching ladder; promoted rows keep
 *  their original added_at. Returns the number promoted. */
export async function resolvePendingFavorites(
  db: LibraryDatabase,
  index: ImportMatchIndex
): Promise<number> {
  const rows = await db.all<{
    sync_key: string;
    title: string;
    artist: string;
    album: string;
    added_at: number;
  }>('SELECT sync_key, title, artist, album, added_at FROM favorite_sync_pending');
  let resolved = 0;
  for (const row of rows) {
    const match = matchSyncEntry({ title: row.title, artist: row.artist, album: row.album }, index);
    if (match.kind !== 'matched') continue;
    await db.run('INSERT OR IGNORE INTO favorites (track_path, added_at) VALUES (?, ?)', [
      match.track.path,
      row.added_at,
    ]);
    await db.run('DELETE FROM favorite_sync_pending WHERE sync_key = ?', [row.sync_key]);
    resolved += 1;
  }
  return resolved;
}

export async function applySyncedFavoriteAdd(
  db: LibraryDatabase,
  trackPath: string,
  syncKey: string,
  addedAt: number
): Promise<void> {
  await db.run('INSERT OR REPLACE INTO favorites (track_path, added_at) VALUES (?, ?)', [
    trackPath,
    addedAt,
  ]);
  await db.run('DELETE FROM favorite_tombstones WHERE sync_key = ?', [syncKey]);
  await db.run('DELETE FROM favorite_sync_pending WHERE sync_key = ?', [syncKey]);
}

export async function applySyncedFavoriteRemove(
  db: LibraryDatabase,
  trackPaths: readonly string[],
  syncKey: string,
  deletedAt: number
): Promise<void> {
  for (const trackPath of trackPaths) {
    await db.run('DELETE FROM favorites WHERE track_path = ?', [trackPath]);
  }
  await db.run('DELETE FROM favorite_sync_pending WHERE sync_key = ?', [syncKey]);
  await db.run('INSERT OR REPLACE INTO favorite_tombstones (sync_key, deleted_at) VALUES (?, ?)', [
    syncKey,
    deletedAt,
  ]);
}

export async function removeFavoriteTombstone(db: LibraryDatabase, syncKey: string): Promise<void> {
  await db.run('DELETE FROM favorite_tombstones WHERE sync_key = ?', [syncKey]);
}

/** Link a local playlist to the desktop's identity (first-sync name pairing).
 *  Must NOT bump updated_at — adopting identity is not an edit. */
export async function adoptPlaylistSyncUid(
  db: LibraryDatabase,
  playlistId: number,
  syncUid: string
): Promise<void> {
  await db.run('UPDATE playlists SET sync_uid = ? WHERE id = ?', [syncUid, playlistId]);
}

export async function removePlaylistTombstone(db: LibraryDatabase, syncUid: string): Promise<void> {
  await db.run('DELETE FROM playlist_tombstones WHERE sync_uid = ?', [syncUid]);
}

/** Create-or-replace a playlist by sync_uid from desktop state (whole-playlist
 *  last-writer-wins). Returns per-entry match counts for the sync summary. */
export async function replaceSyncedPlaylist(
  db: LibraryDatabase,
  input: SyncPlaylist,
  index: ImportMatchIndex
): Promise<{ status: 'created' | 'replaced' | 'skipped-incompatible'; entriesMatched: number; entriesFallback: number }> {
  const kind: SyncPlaylistKind = input.kind === 'dynamic' ? 'dynamic' : 'normal';
  let rulesJson: string | null = null;
  if (kind === 'dynamic') {
    try {
      rulesJson = JSON.stringify(normalizeDynamicPlaylistRules(JSON.parse(input.dynamicRules ?? '')));
    } catch {
      return { status: 'skipped-incompatible', entriesMatched: 0, entriesFallback: 0 };
    }
  }

  const existing = await db.get<{ id: number }>('SELECT id FROM playlists WHERE sync_uid = ?', [
    input.syncUid,
  ]);
  let playlistId: number;
  let created = false;
  if (existing) {
    playlistId = existing.id;
    await db.run(
      'UPDATE playlists SET name = ?, kind = ?, dynamic_rules_json = ?, updated_at = ? WHERE id = ?',
      [input.name, kind, rulesJson, input.updatedAt, playlistId]
    );
    await db.run('DELETE FROM playlist_tracks WHERE playlist_id = ?', [playlistId]);
  } else {
    const result = await db.run(
      `INSERT INTO playlists (name, kind, dynamic_rules_json, created_at, updated_at, sync_uid)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [input.name, kind, rulesJson, input.createdAt, input.updatedAt, input.syncUid]
    );
    playlistId = result.lastInsertRowid;
    created = true;
  }
  await db.run('DELETE FROM playlist_tombstones WHERE sync_uid = ?', [input.syncUid]);

  let entriesMatched = 0;
  let entriesFallback = 0;
  if (kind === 'normal' && Array.isArray(input.entries)) {
    const orderedEntries = [...input.entries].sort((a, b) => a.position - b.position);
    const seenTrackPaths = new Set<string>();
    let position = 0;
    for (const entry of orderedEntries) {
      const match = matchSyncEntry(
        { title: entry.title, artist: entry.artist, album: entry.album, sourcePath: entry.sourcePath },
        index
      );
      let trackPath: string;
      let matched = false;
      if (match.kind === 'matched') {
        trackPath = match.track.path;
        matched = true;
      } else {
        const sourcePath = entry.sourcePath?.trim();
        trackPath = sourcePath || `astra-sync://unmatched/${buildTrackSyncKey(entry.title, entry.artist, entry.album)}`;
      }
      if (seenTrackPaths.has(trackPath)) continue;
      seenTrackPaths.add(trackPath);
      await db.run(
        `INSERT INTO playlist_tracks
           (playlist_id, track_path, position, added_at, fallback_title, fallback_artist, fallback_album)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          playlistId,
          trackPath,
          position++,
          entry.addedAt > 0 ? entry.addedAt : input.updatedAt,
          matched ? null : entry.title || null,
          matched ? null : entry.artist || null,
          matched ? null : entry.album || null,
        ]
      );
      if (matched) {
        entriesMatched += 1;
      } else {
        entriesFallback += 1;
      }
    }
  }

  return { status: created ? 'created' : 'replaced', entriesMatched, entriesFallback };
}

export async function applySyncedPlaylistDelete(
  db: LibraryDatabase,
  syncUid: string,
  deletedAt: number
): Promise<void> {
  // ON DELETE CASCADE removes the entries.
  await db.run('DELETE FROM playlists WHERE sync_uid = ?', [syncUid]);
  await db.run('INSERT OR REPLACE INTO playlist_tombstones (sync_uid, deleted_at) VALUES (?, ?)', [
    syncUid,
    deletedAt,
  ]);
  await db.run('DELETE FROM playlist_sync_state WHERE sync_uid = ?', [syncUid]);
}

// --- Conflict-detection baseline (playlist_sync_state) -----------------------
// The (local, remote) updated_at pair from the last successful sync per
// playlist. With a baseline, sync direction comes from which side changed —
// not the clock — and both-changed becomes a user-facing conflict.

export interface PlaylistSyncBaseline {
  localUpdatedAt: number;
  remoteUpdatedAt: number;
}

export async function getPlaylistSyncBaselines(
  db: LibraryDatabase
): Promise<Map<string, PlaylistSyncBaseline>> {
  const result = new Map<string, PlaylistSyncBaseline>();
  for (const row of await db.all<{
    sync_uid: string;
    local_updated_at: number;
    remote_updated_at: number;
  }>('SELECT sync_uid, local_updated_at, remote_updated_at FROM playlist_sync_state')) {
    result.set(row.sync_uid, {
      localUpdatedAt: row.local_updated_at,
      remoteUpdatedAt: row.remote_updated_at,
    });
  }
  return result;
}

export async function upsertPlaylistSyncBaseline(
  db: LibraryDatabase,
  syncUid: string,
  localUpdatedAt: number,
  remoteUpdatedAt: number
): Promise<void> {
  await db.run(
    'INSERT OR REPLACE INTO playlist_sync_state (sync_uid, local_updated_at, remote_updated_at) VALUES (?, ?, ?)',
    [syncUid, localUpdatedAt, remoteUpdatedAt]
  );
}

export async function deletePlaylistSyncBaseline(db: LibraryDatabase, syncUid: string): Promise<void> {
  await db.run('DELETE FROM playlist_sync_state WHERE sync_uid = ?', [syncUid]);
}

/** Baselines are meaningless against a different desktop — cleared on forget. */
export async function clearPlaylistSyncBaselines(db: LibraryDatabase): Promise<void> {
  await db.run('DELETE FROM playlist_sync_state');
}

/** "Keep both" for a concurrent edit: duplicate the local playlist (entries
 *  included) under a new name + fresh sync identity so both versions survive. */
export async function clonePlaylistAsLocalCopy(
  db: LibraryDatabase,
  playlistId: number,
  newName: string
): Promise<void> {
  const source = await db.get<{ kind: string | null; dynamic_rules_json: string | null }>(
    'SELECT kind, dynamic_rules_json FROM playlists WHERE id = ?',
    [playlistId]
  );
  if (!source) return;
  const now = Date.now();
  const result = await db.run(
    `INSERT INTO playlists (name, kind, dynamic_rules_json, created_at, updated_at, sync_uid)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [newName, source.kind === 'dynamic' ? 'dynamic' : 'normal', source.dynamic_rules_json, now, now, randomSaltHex(16)]
  );
  await db.run(
    `INSERT INTO playlist_tracks (playlist_id, track_path, position, added_at, fallback_title, fallback_artist, fallback_album)
     SELECT ?, track_path, position, added_at, fallback_title, fallback_artist, fallback_album
     FROM playlist_tracks WHERE playlist_id = ?`,
    [result.lastInsertRowid, playlistId]
  );
}

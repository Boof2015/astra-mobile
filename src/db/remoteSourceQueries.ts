// CRUD for the `remote_sources` table (Subsonic/Jellyfin server config). Passwords
// are NOT stored here — see src/services/remoteCredentials.ts (expo-secure-store).

import type { LibraryDatabase } from './database';
import type {
  RemoteSourceRow,
  RemoteSourceStatus,
  RemoteSourceType,
} from '@/types/remote';

export function getRemoteSources(db: LibraryDatabase): Promise<RemoteSourceRow[]> {
  return db.all<RemoteSourceRow>('SELECT * FROM remote_sources ORDER BY created_at');
}

export function getRemoteSource(
  db: LibraryDatabase,
  id: number
): Promise<RemoteSourceRow | undefined> {
  return db.get<RemoteSourceRow>('SELECT * FROM remote_sources WHERE id = ?', [id]);
}

export interface InsertRemoteSourceInput {
  type: RemoteSourceType;
  name: string;
  baseUrl: string;
  username: string;
  enabled: boolean;
}

export async function insertRemoteSource(
  db: LibraryDatabase,
  input: InsertRemoteSourceInput
): Promise<RemoteSourceRow> {
  const now = Date.now();
  const result = await db.run(
    `INSERT INTO remote_sources (type, name, base_url, username, enabled, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [input.type, input.name, input.baseUrl, input.username, input.enabled ? 1 : 0, now, now]
  );
  const row = await getRemoteSource(db, result.lastInsertRowid);
  if (!row) throw new Error('Remote source insert failed');
  return row;
}

export interface UpdateRemoteSourceFields {
  name?: string;
  base_url?: string;
  username?: string;
  enabled?: boolean;
}

export async function updateRemoteSource(
  db: LibraryDatabase,
  id: number,
  fields: UpdateRemoteSourceFields
): Promise<void> {
  const sets: string[] = [];
  const params: (string | number)[] = [];
  if (fields.name !== undefined) {
    sets.push('name = ?');
    params.push(fields.name);
  }
  if (fields.base_url !== undefined) {
    sets.push('base_url = ?');
    params.push(fields.base_url);
  }
  if (fields.username !== undefined) {
    sets.push('username = ?');
    params.push(fields.username);
  }
  if (fields.enabled !== undefined) {
    sets.push('enabled = ?');
    params.push(fields.enabled ? 1 : 0);
  }
  if (sets.length === 0) return;
  sets.push('updated_at = ?');
  params.push(Date.now());
  params.push(id);
  await db.run(`UPDATE remote_sources SET ${sets.join(', ')} WHERE id = ?`, params);
}

export async function deleteRemoteSource(db: LibraryDatabase, id: number): Promise<void> {
  await db.run('DELETE FROM remote_sources WHERE id = ?', [id]);
}

export async function setRemoteSourceStatus(
  db: LibraryDatabase,
  id: number,
  status: RemoteSourceStatus,
  error: string | null
): Promise<void> {
  await db.run(
    `UPDATE remote_sources
       SET last_status = ?, last_error = ?, last_checked_at = ?, updated_at = ?
     WHERE id = ?`,
    [status, error, Date.now(), Date.now(), id]
  );
}

export async function setRemoteSourceSynced(db: LibraryDatabase, id: number): Promise<void> {
  const now = Date.now();
  await db.run(
    `UPDATE remote_sources
       SET last_status = 'ok', last_error = NULL, last_sync_at = ?, last_checked_at = ?, updated_at = ?
     WHERE id = ?`,
    [now, now, now, id]
  );
}

/** Cache Jellyfin auth (Subsonic derives a salted token per request, so it stays NULL). */
export async function setRemoteSourceAuth(
  db: LibraryDatabase,
  id: number,
  auth: { accessToken: string | null; userId: string | null; deviceId: string | null }
): Promise<void> {
  await db.run(
    `UPDATE remote_sources
       SET access_token = ?, user_id = ?, device_id = ?, updated_at = ?
     WHERE id = ?`,
    [auth.accessToken, auth.userId, auth.deviceId, Date.now(), id]
  );
}

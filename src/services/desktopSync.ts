// Desktop LAN sync engine — the mobile side is the merge authority. One run:
// pull the desktop's full favorites/playlists state, merge against local state
// (two-way, deletion tombstones), apply the local half of the merge in one
// transaction, then push only the desktop-bound diff.
// Loop-prevention invariant: everything applied here uses the SOURCE
// timestamps via the desktopSyncQueries apply-variants (never Date.now(), and
// never the tombstone-writing user-mutation paths) so an applied change does
// not read as a fresh local edit on the next run — an immediate second sync
// must produce an empty diff.
// Conflict model: per-playlist baselines (playlist_sync_state) make direction
// come from WHICH side changed since the last sync, not the clock. Only-one-
// side-changed syncs silently; both-changed (or a first-pairing name collision
// with divergent contents) is left untouched and surfaced as a
// DesktopSyncPlaylistConflict for the user to resolve. Timestamp LWW remains
// the fallback for pairs without a baseline yet.

import { openLibraryDb } from '@/db/database';
import { getAllTracks, setSetting } from '@/db/queries';
import { renamePlaylist } from '@/db/playlistQueries';
import {
  adoptPlaylistSyncUid,
  applySyncedFavoriteAdd,
  applySyncedFavoriteRemove,
  applySyncedPlaylistDelete,
  clonePlaylistAsLocalCopy,
  deletePlaylistSyncBaseline,
  ensurePlaylistSyncUids,
  getLocalSyncState,
  getPlaylistSyncBaselines,
  getSyncPlaylistEntries,
  removeFavoriteTombstone,
  removePlaylistTombstone,
  replaceSyncedPlaylist,
  resolvePendingFavorites,
  upsertPendingFavorite,
  upsertPlaylistSyncBaseline,
  type LocalSyncPlaylist,
} from '@/db/desktopSyncQueries';
import { buildImportIndex, matchSyncEntry } from '@/library/playlistFiles';
import { normalizeSyncKeyPart } from '@/shared/sync/identity';
import { syncPlaylistToSnapshot } from '@/shared/sync/conflictPreview';
import { normalizeDynamicPlaylistRules } from '@/shared/playlists/dynamicPlaylist';
import { usePlaylistStore } from '@/stores/playlistStore';
import type { DesktopRemoteConnection } from '@/types/desktopRemote';
import {
  DESKTOP_SYNC_FORMAT,
  DESKTOP_SYNC_MIN_PROTOCOL_VERSION,
  type DesktopSyncApplyPayload,
  type DesktopSyncConflictResolution,
  type DesktopSyncPendingResolution,
  type DesktopSyncPlaylistConflict,
  type DesktopSyncSummary,
  type SyncFavorite,
  type SyncPlaylist,
  type SyncPlaylistEntry,
} from '@/types/desktopSync';
import { mergePlaylistEntries, playlistEntriesEqual } from './desktopSyncPlaylistMerge';
import {
  fetchDesktopRemoteIdentity,
  fetchDesktopSyncState,
  postDesktopSyncApply,
  postDesktopSyncConflicts,
} from './desktopRemoteClient';
import {
  getDesktopRemoteConnection,
  getDesktopRemoteToken,
  setDesktopRemoteConnection,
} from './desktopRemoteCredentials';

const CLOCK_SKEW_WARN_MS = 5 * 60_000;

/** The paired desktop runs a protocol without /v1/sync/* — needs an update. */
export class DesktopSyncUnsupportedError extends Error {
  constructor() {
    super('The desktop app needs an update before it can sync favorites and playlists.');
  }
}

export function desktopSyncSettingKey(connection: Pick<DesktopRemoteConnection, 'id' | 'endpointUuid'>): string {
  return `desktop_sync_last_${connection.endpointUuid ?? connection.id}`;
}

function newestFavorite(a: SyncFavorite | null, b: SyncFavorite | null): SyncFavorite | null {
  if (!a) return b;
  if (!b) return a;
  return b.addedAt > a.addedAt ? b : a;
}

function maxTimestamp(a: number | null, b: number | null): number | null {
  if (a === null) return b;
  if (b === null) return a;
  return Math.max(a, b);
}

function dynamicRulesEqual(a: string | null, b: string | null): boolean {
  if (!a || !b) return a === b;
  try {
    return (
      JSON.stringify(normalizeDynamicPlaylistRules(JSON.parse(a))) ===
      JSON.stringify(normalizeDynamicPlaylistRules(JSON.parse(b)))
    );
  } catch {
    return false;
  }
}

function sanitizePendingResolutions(raw: unknown): DesktopSyncPendingResolution[] {
  if (!Array.isArray(raw)) return [];
  const resolutions: DesktopSyncPendingResolution[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const candidate = item as Record<string, unknown>;
    const syncUid = typeof candidate.syncUid === 'string' ? candidate.syncUid : '';
    const resolution = candidate.resolution;
    if (!syncUid) continue;
    if (resolution !== 'desktop' && resolution !== 'phone' && resolution !== 'both' && resolution !== 'merge') {
      continue;
    }
    const decidedAt = Number(candidate.decidedAt);
    resolutions.push({
      syncUid,
      resolution,
      decidedAt: Number.isFinite(decidedAt) && decidedAt > 0 ? decidedAt : 0,
    });
  }
  return resolutions;
}

/**
 * One sync run + desktop-side signals: applies any conflict resolutions the
 * desktop user chose (re-running once to settle them), then reports the
 * remaining conflicts back so the desktop can display them.
 */
export async function runDesktopSync(): Promise<DesktopSyncSummary> {
  const first = await runDesktopSyncOnce();
  let summary = first.summary;

  const consumedResolutions: string[] = [];
  let appliedAny = false;
  for (const pending of first.pendingResolutions) {
    const conflict = summary.conflicts.find((entry) => entry.syncUid === pending.syncUid);
    if (!conflict) {
      // Already resolved on the phone (or gone) — acknowledge so it clears.
      consumedResolutions.push(pending.syncUid);
      continue;
    }
    try {
      await applyDesktopSyncConflictResolution(conflict, pending.resolution);
      appliedAny = true;
    } catch (error) {
      console.warn('Desktop-chosen sync resolution failed:', error);
    }
    // Consume either way — a bad choice (e.g. merge on a dynamic playlist)
    // re-surfaces as a conflict for the desktop to re-decide, not a loop.
    consumedResolutions.push(pending.syncUid);
  }
  if (appliedAny) {
    summary = (await runDesktopSyncOnce()).summary;
  }

  // Report remaining conflicts (best-effort — older desktops 404 here).
  const connection = await getDesktopRemoteConnection();
  const token = await getDesktopRemoteToken();
  if (connection && token) {
    try {
      await postDesktopSyncConflicts(connection.baseUrl, token, {
        syncFormat: DESKTOP_SYNC_FORMAT,
        conflicts: summary.conflicts.map((conflict) => ({
          kind: conflict.kind,
          syncUid: conflict.syncUid,
          name: conflict.name,
          playlistKind: conflict.playlistKind,
          phoneName: conflict.localName,
          desktopName: conflict.remoteName,
          phoneUpdatedAt: conflict.localUpdatedAt,
          desktopUpdatedAt: conflict.remoteUpdatedAt,
          phoneTrackCount: conflict.localTrackCount,
          desktopTrackCount: conflict.remoteTrackCount,
          phoneSnapshot: syncPlaylistToSnapshot(conflict.local),
          desktopSnapshot: syncPlaylistToSnapshot(conflict.remote),
        })),
        consumedResolutions,
      });
    } catch {
      // The desktop just misses the conflict mirror; sync itself succeeded.
    }
  }

  return summary;
}

async function runDesktopSyncOnce(): Promise<{
  summary: DesktopSyncSummary;
  pendingResolutions: DesktopSyncPendingResolution[];
}> {
  const startedAt = Date.now();
  const connection = await getDesktopRemoteConnection();
  const token = await getDesktopRemoteToken();
  if (!connection || !token) {
    throw new Error('No paired desktop.');
  }

  // The stored protocolVersion predates any desktop upgrade — re-check live and
  // persist the refreshed value before gating.
  const identity = await fetchDesktopRemoteIdentity(connection.baseUrl);
  if (!identity) {
    throw new Error('Desktop is unreachable.');
  }
  if (identity.protocolVersion !== connection.protocolVersion) {
    await setDesktopRemoteConnection({ ...connection, protocolVersion: identity.protocolVersion });
  }
  if (identity.protocolVersion < DESKTOP_SYNC_MIN_PROTOCOL_VERSION) {
    throw new DesktopSyncUnsupportedError();
  }

  const db = await openLibraryDb();
  await ensurePlaylistSyncUids(db);
  const index = buildImportIndex(await getAllTracks(db));
  await resolvePendingFavorites(db, index);
  const local = await getLocalSyncState(db);
  const remote = await fetchDesktopSyncState(connection.baseUrl, token);
  if (remote.syncFormat !== DESKTOP_SYNC_FORMAT) {
    throw new DesktopSyncUnsupportedError();
  }
  if (Math.abs(remote.now - Date.now()) > CLOCK_SKEW_WARN_MS) {
    console.warn(
      `Desktop sync: clock skew of ${Math.round(Math.abs(remote.now - Date.now()) / 1000)}s detected; ` +
        'last-writer-wins conflict resolution may pick the wrong side.'
    );
  }

  const payload: DesktopSyncApplyPayload = {
    syncFormat: DESKTOP_SYNC_FORMAT,
    favoriteAdds: [],
    favoriteRemoves: [],
    playlistUpserts: [],
    playlistDeletes: [],
  };
  const summary: DesktopSyncSummary = {
    favoritesAdded: 0,
    favoritesRemoved: 0,
    favoritesPending: 0,
    playlistsCreated: 0,
    playlistsReplaced: 0,
    playlistsDeleted: 0,
    playlistsSkipped: 0,
    entriesFallback: 0,
    pushedToDesktop: false,
    conflicts: [],
    startedAt,
    finishedAt: startedAt,
  };
  const baselines = await getPlaylistSyncBaselines(db);
  // Baselines are recorded only for playlists that END this run in sync;
  // push-dependent ones wait for the desktop's per-playlist apply result.
  const baselinePlans: { uid: string; localUpdatedAt: number; remoteUpdatedAt: number; afterPush: boolean }[] = [];

  const remoteFavByKey = new Map(remote.favorites.map((favorite) => [favorite.key, favorite]));
  const remoteFavTombByKey = new Map(remote.favoriteTombstones.map((tomb) => [tomb.key, tomb.deletedAt]));
  const remoteByUid = new Map(remote.playlists.map((playlist) => [playlist.syncUid, playlist]));
  const remoteTombByUid = new Map(remote.playlistTombstones.map((tomb) => [tomb.syncUid, tomb.deletedAt]));

  await db.transaction(async (tx) => {
    // ── Favorites ────────────────────────────────────────────────────────────
    const favoriteKeys = new Set<string>([
      ...local.favorites.keys(),
      ...local.favoriteTombstones.keys(),
      ...remoteFavByKey.keys(),
      ...remoteFavTombByKey.keys(),
    ]);
    for (const key of favoriteKeys) {
      const localFav = local.favorites.get(key) ?? null;
      const remoteFav = remoteFavByKey.get(key) ?? null;
      const localTombAt = local.favoriteTombstones.get(key) ?? null;
      const bestAdd = newestFavorite(localFav, remoteFav);
      const bestDelAt = maxTimestamp(localTombAt, remoteFavTombByKey.get(key) ?? null);
      // Tie between an add and a delete keeps the favorite (deterministic on
      // both sides).
      const present = bestAdd !== null && (bestDelAt === null || bestAdd.addedAt >= bestDelAt);

      if (present) {
        if (localTombAt !== null) {
          await removeFavoriteTombstone(tx, key);
        }
        if (!localFav || localFav.pending) {
          const match = matchSyncEntry(
            { title: bestAdd.title, artist: bestAdd.artist, album: bestAdd.album },
            index
          );
          if (match.kind === 'matched') {
            await applySyncedFavoriteAdd(tx, match.track.path, key, bestAdd.addedAt);
            summary.favoritesAdded += 1;
          } else if (!localFav || localFav.addedAt < bestAdd.addedAt) {
            await upsertPendingFavorite(tx, {
              key,
              title: bestAdd.title,
              artist: bestAdd.artist,
              album: bestAdd.album,
              addedAt: bestAdd.addedAt,
            });
            if (!localFav) summary.favoritesPending += 1;
          }
        }
        if (!remoteFav) {
          payload.favoriteAdds.push({
            key,
            title: bestAdd.title,
            artist: bestAdd.artist,
            album: bestAdd.album,
            addedAt: bestAdd.addedAt,
          });
        }
      } else if (bestDelAt !== null) {
        if (localFav) {
          await applySyncedFavoriteRemove(tx, localFav.trackPaths, key, bestDelAt);
          if (!localFav.pending) summary.favoritesRemoved += 1;
        } else if (localTombAt === null || localTombAt < bestDelAt) {
          // Record the peer's tombstone locally so the merge stays
          // deterministic even if the desktop ever loses its copy.
          await applySyncedFavoriteRemove(tx, [], key, bestDelAt);
        }
        if (remoteFav) {
          payload.favoriteRemoves.push({ key, deletedAt: bestDelAt });
        }
      }
    }

    // ── Playlists ────────────────────────────────────────────────────────────
    const localByUid = new Map(local.playlists.map((playlist) => [playlist.syncUid, playlist]));
    const skippedConflictUids = new Set<string>();

    const localContentsFor = async (row: LocalSyncPlaylist): Promise<SyncPlaylistEntry[]> =>
      row.kind === 'normal' ? getSyncPlaylistEntries(tx, row.id) : [];

    const contentsMatch = async (
      localRow: LocalSyncPlaylist,
      remoteRow: SyncPlaylist,
      localEntries: SyncPlaylistEntry[]
    ): Promise<boolean> => {
      if (localRow.kind !== remoteRow.kind) return false;
      if (localRow.kind === 'dynamic') {
        return dynamicRulesEqual(localRow.dynamicRules, remoteRow.dynamicRules);
      }
      return playlistEntriesEqual(localEntries, remoteRow.entries ?? []);
    };

    const buildConflict = (
      kind: DesktopSyncPlaylistConflict['kind'],
      localRow: LocalSyncPlaylist,
      remoteRow: SyncPlaylist,
      localEntries: SyncPlaylistEntry[]
    ): DesktopSyncPlaylistConflict => {
      const localSnapshot: SyncPlaylist = {
        syncUid: localRow.syncUid,
        name: localRow.name,
        kind: localRow.kind,
        dynamicRules: localRow.kind === 'dynamic' ? localRow.dynamicRules : null,
        createdAt: localRow.createdAt,
        updatedAt: localRow.updatedAt,
        entries: localRow.kind === 'normal' ? localEntries : null,
      };
      return {
        kind,
        syncUid: remoteRow.syncUid,
        localPlaylistId: localRow.id,
        localSyncUid: localRow.syncUid,
        name: localRow.name,
        playlistKind: localRow.kind === 'normal' && remoteRow.kind === 'normal' ? 'normal' : 'dynamic',
        localName: localRow.name,
        remoteName: remoteRow.name,
        localUpdatedAt: localRow.updatedAt,
        remoteUpdatedAt: remoteRow.updatedAt,
        localTrackCount: localSnapshot.entries?.length ?? 0,
        remoteTrackCount: remoteRow.entries?.length ?? 0,
        local: localSnapshot,
        remote: remoteRow,
      };
    };

    // First sync of a playlist that exists on both sides under different uids:
    // pair case-insensitively by name and adopt the DESKTOP uid (identity
    // adoption is not an edit — updated_at stays put). Pairing only happens
    // automatically when the contents already match; divergent same-named
    // lists become a first-pairing conflict and BOTH copies are left alone.
    for (const remotePlaylist of remote.playlists) {
      if (localByUid.has(remotePlaylist.syncUid)) continue;
      if (local.playlistTombstones.has(remotePlaylist.syncUid)) continue;
      const nameKey = normalizeSyncKeyPart(remotePlaylist.name);
      if (!nameKey) continue;
      let paired: LocalSyncPlaylist | null = null;
      for (const candidate of local.playlists) {
        if (candidate.syncUid === remotePlaylist.syncUid) continue;
        if (remoteByUid.has(candidate.syncUid) || remoteTombByUid.has(candidate.syncUid)) continue;
        if (normalizeSyncKeyPart(candidate.name) !== nameKey) continue;
        if (paired === null || candidate.id < paired.id) paired = candidate;
      }
      if (!paired) continue;
      const pairedEntries = await localContentsFor(paired);
      if (await contentsMatch(paired, remotePlaylist, pairedEntries)) {
        await adoptPlaylistSyncUid(tx, paired.id, remotePlaylist.syncUid);
        localByUid.delete(paired.syncUid);
        paired.syncUid = remotePlaylist.syncUid;
        localByUid.set(remotePlaylist.syncUid, paired);
      } else {
        summary.conflicts.push(
          buildConflict('first-pairing', paired, remotePlaylist, pairedEntries)
        );
        skippedConflictUids.add(remotePlaylist.syncUid);
        skippedConflictUids.add(paired.syncUid);
      }
    }

    const playlistUids = new Set<string>([
      ...localByUid.keys(),
      ...remoteByUid.keys(),
      ...local.playlistTombstones.keys(),
      ...remoteTombByUid.keys(),
    ]);
    for (const uid of playlistUids) {
      if (skippedConflictUids.has(uid)) continue;
      const localRow = localByUid.get(uid) ?? null;
      const remoteRow = remoteByUid.get(uid) ?? null;
      const localTombAt = local.playlistTombstones.get(uid) ?? null;
      const bestTombAt = maxTimestamp(localTombAt, remoteTombByUid.get(uid) ?? null);
      const bestRowAt = maxTimestamp(localRow?.updatedAt ?? null, remoteRow?.updatedAt ?? null);

      // Deletion wins only when strictly newer than the newest edit.
      if (bestTombAt !== null && (bestRowAt === null || bestTombAt > bestRowAt)) {
        if (localRow) {
          await applySyncedPlaylistDelete(tx, uid, bestTombAt);
          summary.playlistsDeleted += 1;
        } else if (localTombAt === null || localTombAt < bestTombAt) {
          await applySyncedPlaylistDelete(tx, uid, bestTombAt);
        }
        await deletePlaylistSyncBaseline(tx, uid);
        if (remoteRow) {
          payload.playlistDeletes.push({ syncUid: uid, deletedAt: bestTombAt });
        }
        continue;
      }

      const pushLocal = async (row: LocalSyncPlaylist) => {
        if (localTombAt !== null) {
          await removePlaylistTombstone(tx, uid);
        }
        payload.playlistUpserts.push({
          syncUid: uid,
          name: row.name,
          kind: row.kind,
          dynamicRules: row.dynamicRules,
          createdAt: row.createdAt,
          updatedAt: row.updatedAt,
          entries: row.kind === 'normal' ? await getSyncPlaylistEntries(tx, row.id) : null,
        } satisfies SyncPlaylist);
        baselinePlans.push({
          uid,
          localUpdatedAt: row.updatedAt,
          remoteUpdatedAt: row.updatedAt,
          afterPush: true,
        });
      };

      const applyRemote = async (row: SyncPlaylist) => {
        const result = await replaceSyncedPlaylist(tx, row, index);
        if (result.status === 'created') summary.playlistsCreated += 1;
        else if (result.status === 'replaced') summary.playlistsReplaced += 1;
        else summary.playlistsSkipped += 1;
        summary.entriesFallback += result.entriesFallback;
        if (result.status !== 'skipped-incompatible') {
          baselinePlans.push({
            uid,
            localUpdatedAt: row.updatedAt,
            remoteUpdatedAt: row.updatedAt,
            afterPush: false,
          });
        }
      };

      // With a baseline, sync direction comes from WHICH side changed since
      // the last run — the clock only matters when both did (conflict).
      const baseline = baselines.get(uid) ?? null;
      if (baseline && localRow && remoteRow) {
        const localChanged = localRow.updatedAt !== baseline.localUpdatedAt;
        const remoteChanged = remoteRow.updatedAt !== baseline.remoteUpdatedAt;
        if (localChanged && remoteChanged) {
          const localEntries = await localContentsFor(localRow);
          const trivial =
            localRow.name.trim() === remoteRow.name.trim() &&
            (await contentsMatch(localRow, remoteRow, localEntries));
          if (trivial) {
            // Both sides moved to the same result (e.g. identical edits) —
            // just advance the baseline.
            baselinePlans.push({
              uid,
              localUpdatedAt: localRow.updatedAt,
              remoteUpdatedAt: remoteRow.updatedAt,
              afterPush: false,
            });
          } else {
            summary.conflicts.push(
              buildConflict('concurrent-edit', localRow, remoteRow, localEntries)
            );
          }
          continue;
        }
        if (remoteChanged) {
          await applyRemote(remoteRow);
          continue;
        }
        if (localChanged) {
          await pushLocal(localRow);
          continue;
        }
        continue; // Neither side moved.
      }

      // No baseline yet (first sync of this pair): timestamp last-writer-wins.
      if (remoteRow && (localRow === null || localRow.updatedAt < remoteRow.updatedAt)) {
        await applyRemote(remoteRow);
        continue;
      }
      if (localRow && (remoteRow === null || remoteRow.updatedAt < localRow.updatedAt)) {
        await pushLocal(localRow);
        continue;
      }
      if (localRow && remoteRow) {
        // Equal timestamps on both sides: in sync — record the first baseline.
        baselinePlans.push({
          uid,
          localUpdatedAt: localRow.updatedAt,
          remoteUpdatedAt: remoteRow.updatedAt,
          afterPush: false,
        });
      }
    }
  });

  // Baselines that don't depend on the push are valid as soon as the local
  // transaction committed.
  for (const plan of baselinePlans) {
    if (plan.afterPush) continue;
    const existing = baselines.get(plan.uid);
    if (
      existing &&
      existing.localUpdatedAt === plan.localUpdatedAt &&
      existing.remoteUpdatedAt === plan.remoteUpdatedAt
    ) {
      continue;
    }
    await upsertPlaylistSyncBaseline(db, plan.uid, plan.localUpdatedAt, plan.remoteUpdatedAt);
  }

  const hasDiff =
    payload.favoriteAdds.length > 0 ||
    payload.favoriteRemoves.length > 0 ||
    payload.playlistUpserts.length > 0 ||
    payload.playlistDeletes.length > 0;
  if (hasDiff) {
    const result = await postDesktopSyncApply(connection.baseUrl, token, payload);
    summary.pushedToDesktop = true;
    summary.favoritesAdded += result.favorites.added;
    summary.favoritesPending += result.favorites.pending;
    summary.favoritesRemoved += result.favorites.removed;
    const pushStatusByUid = new Map(result.playlists.map((entry) => [entry.syncUid, entry.status]));
    for (const playlistResult of result.playlists) {
      if (playlistResult.status === 'created') summary.playlistsCreated += 1;
      else if (playlistResult.status === 'replaced') summary.playlistsReplaced += 1;
      else if (playlistResult.status === 'deleted') summary.playlistsDeleted += 1;
      else summary.playlistsSkipped += 1;
      summary.entriesFallback += playlistResult.entriesFallback;
    }
    // Push-dependent baselines only count once the desktop confirmed the
    // upsert; a failed/skipped push re-syncs naturally next run.
    for (const plan of baselinePlans) {
      if (!plan.afterPush) continue;
      const status = pushStatusByUid.get(plan.uid);
      if (status !== 'created' && status !== 'replaced') continue;
      await upsertPlaylistSyncBaseline(db, plan.uid, plan.localUpdatedAt, plan.remoteUpdatedAt);
    }
  }

  await setSetting(db, desktopSyncSettingKey(connection), String(Date.now()));
  await usePlaylistStore.getState().refresh();

  summary.finishedAt = Date.now();
  return { summary, pendingResolutions: sanitizePendingResolutions(remote.pendingResolutions) };
}

/**
 * Applies the user's choice for one sync conflict LOCALLY (no network):
 * either adjusting the sync baseline so the next run pulls/pushes the chosen
 * side, or restructuring the local copies for keep-both/merge. The caller
 * should run a sync afterwards to settle both devices; if the desktop moved
 * again in the meantime the conflict legitimately re-surfaces.
 */
export async function applyDesktopSyncConflictResolution(
  conflict: DesktopSyncPlaylistConflict,
  resolution: DesktopSyncConflictResolution
): Promise<void> {
  const db = await openLibraryDb();
  const currentRow = await db.get<{ updated_at: number; name: string }>(
    'SELECT updated_at, name FROM playlists WHERE id = ?',
    [conflict.localPlaylistId]
  );
  if (!currentRow) {
    // The local copy vanished since detection — nothing to choose between;
    // the next sync settles whatever remains.
    return;
  }

  switch (resolution) {
    case 'desktop': {
      if (conflict.kind === 'first-pairing') {
        await adoptPlaylistSyncUid(db, conflict.localPlaylistId, conflict.syncUid);
      }
      // Local reads as unchanged, remote as changed → next run pulls desktop.
      await upsertPlaylistSyncBaseline(db, conflict.syncUid, currentRow.updated_at, 0);
      break;
    }
    case 'phone': {
      if (conflict.kind === 'first-pairing') {
        await adoptPlaylistSyncUid(db, conflict.localPlaylistId, conflict.syncUid);
      }
      // Remote reads as unchanged (as of detection), local as changed → next
      // run pushes the phone copy.
      await upsertPlaylistSyncBaseline(db, conflict.syncUid, 0, conflict.remoteUpdatedAt);
      break;
    }
    case 'both': {
      const copyName = `${currentRow.name} (Phone)`;
      if (conflict.kind === 'first-pairing') {
        // Rename the local copy out of the collision; both lists then sync as
        // independent playlists.
        await renamePlaylist(db, conflict.localPlaylistId, copyName);
      } else {
        // Duplicate the local version under a fresh identity, then let the
        // shared uid take the desktop version.
        await clonePlaylistAsLocalCopy(db, conflict.localPlaylistId, copyName);
        await upsertPlaylistSyncBaseline(db, conflict.syncUid, currentRow.updated_at, 0);
      }
      break;
    }
    case 'merge': {
      if (conflict.playlistKind !== 'normal') {
        throw new Error('Dynamic playlists cannot be merged — keep one side instead.');
      }
      const localEntries = await getSyncPlaylistEntries(db, conflict.localPlaylistId);
      const remoteEntries = conflict.remote.entries ?? [];
      const localIsNewer = conflict.localUpdatedAt >= conflict.remoteUpdatedAt;
      const merged = mergePlaylistEntries(
        localIsNewer ? localEntries : remoteEntries,
        localIsNewer ? remoteEntries : localEntries
      );
      if (conflict.kind === 'first-pairing') {
        await adoptPlaylistSyncUid(db, conflict.localPlaylistId, conflict.syncUid);
      }
      const index = buildImportIndex(await getAllTracks(db));
      await replaceSyncedPlaylist(
        db,
        {
          syncUid: conflict.syncUid,
          name: localIsNewer ? currentRow.name : conflict.remote.name,
          kind: 'normal',
          dynamicRules: null,
          createdAt: conflict.remote.createdAt,
          updatedAt: Date.now(),
          entries: merged,
        },
        index
      );
      // The merged list is a fresh local edit → next run pushes it.
      await upsertPlaylistSyncBaseline(db, conflict.syncUid, 0, conflict.remoteUpdatedAt);
      break;
    }
  }

  await usePlaylistStore.getState().refresh();
}

// Remote sources (Subsonic/Jellyfin) — config, connection test, and catalog sync.
// SQLite (remote_sources) + expo-secure-store (passwords) are the source of truth;
// this store mirrors the rows in memory and tracks per-source sync progress.
//
// The decrypted config + cached Jellyfin token are pushed into the synchronous
// registry (services/remoteConfig) so the library UI and playback can build URLs.

import { create } from 'zustand';
import { openLibraryDb } from '@/db/database';
import { deleteRemoteTracksBySource } from '@/db/queries';
import {
  deleteFavoritesByPathPrefix,
  deleteRemotePlaylistsBySource,
} from '@/db/playlistQueries';
import { recomputeAlbumIdentity } from '@/library/albumIdentity';
import {
  deleteRemoteSource,
  getRemoteSource,
  getRemoteSources,
  insertRemoteSource,
  setRemoteSourceArtAuth,
  setRemoteSourceAuth,
  setRemoteSourceStatus,
  setRemoteSourceSynced,
  updateRemoteSource,
} from '@/db/remoteSourceQueries';
import { buildCoverArtUrlTemplate } from '@/services/remoteUrls';
import {
  deleteRemoteSecret,
  getRemoteSecret,
  setRemoteSecret,
} from '@/services/remoteCredentials';
import {
  clearResolvedRemoteConfig,
  setResolvedRemoteConfig,
  updateResolvedRemoteAuth,
} from '@/services/remoteConfig';
import {
  authenticateJellyfin,
  buildJellyfinDeviceId,
  testJellyfinConnection,
  type JellyfinAuthContext,
} from '@/services/jellyfin';
import { testSubsonicConnection } from '@/services/subsonic';
import { syncRemoteSource } from '@/library/remoteSync';
import { useLibraryStore } from '@/stores/libraryStore';
import type {
  RemoteConnectionConfig,
  RemoteSourceCreateInput,
  RemoteSourceRow,
  RemoteSourceTestInput,
  RemoteSourceTestResult,
  RemoteSourceUpdateInput,
  RemoteSyncProgress,
} from '@/types/remote';

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Hydrate the synchronous URL-building registry for one source (loads its secret). */
async function hydrateRegistry(source: RemoteSourceRow): Promise<RemoteConnectionConfig | null> {
  const password = await getRemoteSecret(source.id);
  if (password == null) return null;
  setResolvedRemoteConfig({
    id: source.id,
    type: source.type,
    baseUrl: source.base_url,
    username: source.username,
    password,
    accessToken: source.access_token ?? undefined,
    userId: source.user_id ?? undefined,
  });
  await persistArtAuthIfNeeded(source);
  return { baseUrl: source.base_url, username: source.username, password };
}

/**
 * Generate + persist the cover-art URL template the native Android Auto artwork provider
 * reads. Done once per source (stable Subsonic salt; Jellyfin token); regenerated when
 * credentials change (updateSource clears it) or a Jellyfin token is refreshed.
 * Requires the source's config to already be in the registry.
 */
async function persistArtAuthIfNeeded(source: RemoteSourceRow): Promise<void> {
  if (source.art_auth) return;
  const template = buildCoverArtUrlTemplate(source.id);
  if (!template) return;
  const db = await openLibraryDb();
  await setRemoteSourceArtAuth(db, source.id, template);
}

/** Ensure a usable Jellyfin token, authenticating + persisting it if missing. */
async function ensureJellyfinAuth(
  source: RemoteSourceRow,
  config: RemoteConnectionConfig
): Promise<JellyfinAuthContext> {
  if (source.access_token && source.user_id) {
    return { accessToken: source.access_token, userId: source.user_id };
  }
  const auth = await authenticateJellyfin(config);
  const db = await openLibraryDb();
  await setRemoteSourceAuth(db, source.id, {
    accessToken: auth.accessToken,
    userId: auth.userId,
    deviceId: buildJellyfinDeviceId(config),
  });
  updateResolvedRemoteAuth(source.id, auth);
  // Token (re)issued — refresh the native Auto cover-art template so it isn't stale.
  const artTemplate = buildCoverArtUrlTemplate(source.id);
  if (artTemplate) await setRemoteSourceArtAuth(db, source.id, artTemplate);
  return auth;
}

interface RemoteSourcesStore {
  sources: RemoteSourceRow[];
  initialized: boolean;
  /** Per-source live sync progress (null = not syncing). */
  progressById: Record<number, RemoteSyncProgress | null>;

  init: () => Promise<void>;
  refresh: () => Promise<void>;
  testSource: (input: RemoteSourceTestInput) => Promise<RemoteSourceTestResult>;
  createSource: (input: RemoteSourceCreateInput) => Promise<RemoteSourceRow>;
  updateSource: (id: number, input: RemoteSourceUpdateInput) => Promise<void>;
  deleteSource: (id: number, purgeTracks: boolean) => Promise<void>;
  syncSource: (id: number) => Promise<void>;
  syncAll: () => Promise<void>;
}

export const useRemoteSourcesStore = create<RemoteSourcesStore>((set, get) => ({
  sources: [],
  initialized: false,
  progressById: {},

  init: async () => {
    if (get().initialized) return;
    const db = await openLibraryDb();
    const sources = await getRemoteSources(db);
    // Populate the URL registry from cached config/token (no network on launch).
    await Promise.all(sources.filter((s) => s.enabled).map((s) => hydrateRegistry(s)));
    set({ sources, initialized: true });
    // The library's initial refresh may have run before the registry was hydrated,
    // leaving remote artwork URLs unresolved — refresh once more now that it's ready.
    if (sources.length > 0) {
      await useLibraryStore.getState().refresh();
    }
  },

  refresh: async () => {
    const db = await openLibraryDb();
    set({ sources: await getRemoteSources(db) });
  },

  testSource: async (input) => {
    try {
      const config: RemoteConnectionConfig = {
        baseUrl: input.baseUrl,
        username: input.username,
        password: input.password,
      };
      if (input.type === 'subsonic') {
        await testSubsonicConnection(config);
      } else {
        await testJellyfinConnection(config);
      }
      return { ok: true, message: 'Connection successful.' };
    } catch (error) {
      return { ok: false, message: errorMessage(error) };
    }
  },

  createSource: async (input) => {
    const db = await openLibraryDb();
    const config: RemoteConnectionConfig = {
      baseUrl: input.baseUrl,
      username: input.username,
      password: input.password,
    };

    // Validate before persisting anything.
    let auth: JellyfinAuthContext | null = null;
    if (input.type === 'subsonic') {
      await testSubsonicConnection(config);
    } else {
      auth = await authenticateJellyfin(config);
    }

    const row = await insertRemoteSource(db, {
      type: input.type,
      name: input.name,
      baseUrl: input.baseUrl,
      username: input.username,
      enabled: input.enabled,
    });
    await setRemoteSecret(row.id, input.password);

    if (auth) {
      await setRemoteSourceAuth(db, row.id, {
        accessToken: auth.accessToken,
        userId: auth.userId,
        deviceId: buildJellyfinDeviceId(config),
      });
    }

    setResolvedRemoteConfig({
      id: row.id,
      type: row.type,
      baseUrl: row.base_url,
      username: row.username,
      password: input.password,
      accessToken: auth?.accessToken,
      userId: auth?.userId,
    });
    await persistArtAuthIfNeeded(row);

    await get().refresh();
    // Kick off the first sync in the background (don't block the add flow).
    void get().syncSource(row.id);
    return row;
  },

  updateSource: async (id, input) => {
    const db = await openLibraryDb();
    const existing = await getRemoteSource(db, id);
    if (!existing) return;

    await updateRemoteSource(db, id, {
      name: input.name,
      base_url: input.baseUrl,
      username: input.username,
      enabled: input.enabled,
    });
    if (input.password) {
      await setRemoteSecret(id, input.password);
    }

    const updated = await getRemoteSource(db, id);
    if (updated) {
      // Connection details may have changed → drop cached token + cover-art template,
      // re-hydrate registry (which regenerates the template from the new credentials).
      if (input.baseUrl || input.username || input.password) {
        await setRemoteSourceAuth(db, id, { accessToken: null, userId: null, deviceId: null });
        await setRemoteSourceArtAuth(db, id, null);
      }
      const fresh = (await getRemoteSource(db, id)) ?? updated;
      await hydrateRegistry(fresh);
    }
    await get().refresh();
  },

  deleteSource: async (id, purgeTracks) => {
    const db = await openLibraryDb();
    const source = await getRemoteSource(db, id);
    if (purgeTracks && source) {
      await deleteRemoteTracksBySource(db, source.type, id);
      // Drop this source's synced playlists + favorites (favorites key on the
      // `${type}://${id}/` path prefix).
      await deleteRemotePlaylistsBySource(db, id);
      await deleteFavoritesByPathPrefix(db, `${source.type}://${id}/`);
      // Removals can regroup albums (compilation heuristic is cross-track).
      await recomputeAlbumIdentity(db);
    }
    await deleteRemoteSource(db, id);
    await deleteRemoteSecret(id);
    clearResolvedRemoteConfig(id);
    await get().refresh();
    if (purgeTracks) {
      await useLibraryStore.getState().refresh();
    }
  },

  syncSource: async (id) => {
    const db = await openLibraryDb();
    const source = await getRemoteSource(db, id);
    if (!source) return;
    if (get().progressById[id]) return; // already syncing

    const config = await hydrateRegistry(source);
    if (!config) {
      await setRemoteSourceStatus(db, id, 'error', 'Missing stored password.');
      await get().refresh();
      return;
    }

    const onProgress = (progress: RemoteSyncProgress) => {
      set((state) => ({ progressById: { ...state.progressById, [id]: progress } }));
    };
    set((state) => ({
      progressById: { ...state.progressById, [id]: { phase: 'connecting', current: 0, total: 0, detail: null } },
    }));

    try {
      let authContext: JellyfinAuthContext | undefined;
      if (source.type === 'jellyfin') {
        authContext = await ensureJellyfinAuth(source, config);
      }
      await syncRemoteSource(db, source, config, { onProgress, authContext });
      await setRemoteSourceSynced(db, id);
      await useLibraryStore.getState().refresh();
    } catch (error) {
      await setRemoteSourceStatus(db, id, 'error', errorMessage(error));
    } finally {
      set((state) => ({ progressById: { ...state.progressById, [id]: null } }));
      await get().refresh();
    }
  },

  syncAll: async () => {
    const enabled = get().sources.filter((source) => source.enabled);
    for (const source of enabled) {
      await get().syncSource(source.id);
    }
  },
}));

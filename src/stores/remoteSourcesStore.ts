// Remote sources (Subsonic/Jellyfin) — config, connection test, and catalog sync.
// SQLite (remote_sources) + expo-secure-store (passwords) are the source of truth;
// this store mirrors the rows in memory and tracks per-source sync progress.
//
// The decrypted config + cached Jellyfin token are pushed into the synchronous
// registry (services/remoteConfig) so the library UI and playback can build URLs.

import { create } from 'zustand';
import { AstraLibraryData } from '../../modules/astra-library-scanner';
import { buildCoverArtUrlTemplate } from '@/services/remoteUrls';
import {
  deleteRemoteSecret,
  getRemoteSecret,
  getRemoteSecureAuth,
  setRemoteArtAuth,
  setRemoteSecret,
  setRemoteSecureAuth,
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
  const [password, auth] = await Promise.all([
    getRemoteSecret(source.id),
    getRemoteSecureAuth(source.id),
  ]);
  if (password == null) return null;
  setResolvedRemoteConfig({
    id: source.id,
    type: source.type,
    baseUrl: source.base_url,
    username: source.username,
    password,
    accessToken: auth.accessToken ?? undefined,
    userId: auth.userId ?? undefined,
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
  if ((await getRemoteSecureAuth(source.id)).artAuth) return;
  const template = buildCoverArtUrlTemplate(source.id);
  if (!template) return;
  await setRemoteArtAuth(source.id, template);
}

/** Ensure a usable Jellyfin token, authenticating + persisting it if missing. */
async function ensureJellyfinAuth(
  source: RemoteSourceRow,
  config: RemoteConnectionConfig
): Promise<JellyfinAuthContext> {
  const cached = await getRemoteSecureAuth(source.id);
  if (cached.accessToken && cached.userId) {
    return { accessToken: cached.accessToken, userId: cached.userId };
  }
  const auth = await authenticateJellyfin(config);
  await setRemoteSecureAuth(source.id, {
    accessToken: auth.accessToken,
    userId: auth.userId,
    deviceId: buildJellyfinDeviceId(config),
  });
  updateResolvedRemoteAuth(source.id, auth);
  // Token (re)issued — refresh the native Auto cover-art template so it isn't stale.
  const artTemplate = buildCoverArtUrlTemplate(source.id);
  if (artTemplate) await setRemoteArtAuth(source.id, artTemplate);
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

let initPromise: Promise<void> | null = null;
let recoverySubscriptionInstalled = false;

export const useRemoteSourcesStore = create<RemoteSourcesStore>((set, get) => ({
  sources: [],
  initialized: false,
  progressById: {},

  init: () => {
    if (get().initialized) return Promise.resolve();
    if (!initPromise) {
      initPromise = (async () => {
        const sources = await AstraLibraryData.listRemoteSources<RemoteSourceRow>();
        // Populate the URL registry from cached config/token (no network on launch).
        await Promise.all(sources.filter((s) => s.enabled).map((s) => hydrateRegistry(s)));
        set({ sources, initialized: true });
        if (!recoverySubscriptionInstalled) {
          recoverySubscriptionInstalled = true;
          AstraLibraryData.addListener('onLibraryStatus', (status) => {
            if (status.status === 'rebuilding') {
              void get().syncAll();
            }
          });
        }
        if (AstraLibraryData.getCurrentStatus().status === 'rebuilding') {
          void get().syncAll();
        }
        // The library's initial refresh may have run before the registry was hydrated,
        // leaving remote artwork URLs unresolved — refresh once more now that it's ready.
        if (sources.length > 0) {
          await useLibraryStore.getState().refresh();
        }
      })().catch((error) => {
        initPromise = null;
        throw error;
      });
    }
    return initPromise;
  },

  refresh: async () => {
    set({ sources: await AstraLibraryData.listRemoteSources<RemoteSourceRow>() });
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

    const row = await AstraLibraryData.createRemoteSource<RemoteSourceRow>(
      input.type,
      input.name,
      input.baseUrl,
      input.username,
      input.enabled
    );
    await setRemoteSecret(row.id, input.password);

    if (auth) {
      await setRemoteSecureAuth(row.id, {
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
    const existing = await AstraLibraryData.getRemoteSource<RemoteSourceRow>(id);
    if (!existing) return;

    await AstraLibraryData.updateRemoteSource(id, {
      name: input.name,
      base_url: input.baseUrl,
      username: input.username,
      enabled: input.enabled,
    });
    if (input.password) {
      await setRemoteSecret(id, input.password);
    }

    const updated = await AstraLibraryData.getRemoteSource<RemoteSourceRow>(id);
    if (updated) {
      // Connection details may have changed → drop cached token + cover-art template,
      // re-hydrate registry (which regenerates the template from the new credentials).
      if (input.baseUrl || input.username || input.password) {
        await setRemoteSecureAuth(id, {
          accessToken: null,
          userId: null,
          deviceId: null,
        });
        await setRemoteArtAuth(id, null);
      }
      const fresh = (await AstraLibraryData.getRemoteSource<RemoteSourceRow>(id)) ?? updated;
      await hydrateRegistry(fresh);
    }
    await get().refresh();
  },

  deleteSource: async (id, purgeTracks) => {
    await AstraLibraryData.deleteRemoteSource(id, purgeTracks);
    await deleteRemoteSecret(id);
    clearResolvedRemoteConfig(id);
    await get().refresh();
    if (purgeTracks) {
      await useLibraryStore.getState().refresh();
    }
  },

  syncSource: async (id) => {
    const source = await AstraLibraryData.getRemoteSource<RemoteSourceRow>(id);
    if (!source) return;
    if (get().progressById[id]) return; // already syncing

    const config = await hydrateRegistry(source);
    if (!config) {
      await AstraLibraryData.setRemoteSourceStatus(id, 'error', 'Missing stored password.');
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
      await syncRemoteSource(source, config, { onProgress, authContext });
      await AstraLibraryData.setRemoteSourceStatus(id, 'ok', null);
      await useLibraryStore.getState().refresh();
    } catch (error) {
      await AstraLibraryData.setRemoteSourceStatus(id, 'error', errorMessage(error));
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

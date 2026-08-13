// Remote catalog sync orchestration (M5). Mirrors src/library/scanner.ts for local
// folders: fetch the server catalog -> upsert into `tracks` -> prune removed tracks.
// The caller (remoteSourcesStore) owns status/progress writes and libraryStore.refresh.

import { AstraLibraryData } from '../../modules/astra-library-scanner';
import {
  buildSubsonicTrackPath,
  fetchSubsonicStarredTrackIds,
  syncSubsonicCatalog,
  syncSubsonicPlaylists,
} from '@/services/subsonic';
import { syncJellyfinCatalog, type JellyfinAuthContext } from '@/services/jellyfin';
import type {
  RemoteConnectionConfig,
  RemotePlaylist,
  RemoteSourceRow,
  RemoteSyncProgress,
} from '@/types/remote';

const UPSERT_BATCH = 200;

export interface SyncRemoteResult {
  tracksScanned: number;
  removed: number;
}

export interface SyncRemoteOptions {
  onProgress?: (progress: RemoteSyncProgress) => void;
  /** Reuse an already-obtained Jellyfin auth (avoids a second AuthenticateByName). */
  authContext?: JellyfinAuthContext;
  signal?: AbortSignal;
}

export async function syncRemoteSource(
  source: RemoteSourceRow,
  config: RemoteConnectionConfig,
  options: SyncRemoteOptions = {}
): Promise<SyncRemoteResult> {
  options.onProgress?.({ phase: 'connecting', current: 0, total: 0, detail: null });

  const syncId = await AstraLibraryData.beginRemoteSync(source.id, source.type);
  let streamedTracks = 0;
  const appendTracks = async (tracks: Record<string, unknown>[]) => {
    for (let index = 0; index < tracks.length; index += UPSERT_BATCH) {
      const batch = tracks.slice(index, index + UPSERT_BATCH);
      await AstraLibraryData.appendRemoteTracks(syncId, batch);
      streamedTracks += batch.length;
      options.onProgress?.({
        phase: 'saving',
        current: streamedTracks,
        total: streamedTracks,
        detail: null,
      });
    }
  };

  try {
    let favoritePaths: string[] = [];
    let remotePlaylists: RemotePlaylist[] = [];
    if (source.type === 'subsonic') {
      const requestOptions = {
        onProgress: options.onProgress,
        signal: options.signal,
      };
      const [, starredIds, playlists] = await Promise.all([
        syncSubsonicCatalog(source.id, config, {
          ...requestOptions,
          collectTracks: false,
          onTracksBatch: (tracks) => appendTracks(
            tracks as unknown as Record<string, unknown>[],
          ),
        }),
        fetchSubsonicStarredTrackIds(config, requestOptions),
        syncSubsonicPlaylists(source.id, config, requestOptions),
      ]);
      favoritePaths = starredIds.map((id) => buildSubsonicTrackPath(source.id, id));
      remotePlaylists = playlists;
    } else {
      await syncJellyfinCatalog(source.id, config, {
        onProgress: options.onProgress,
        authContext: options.authContext,
        signal: options.signal,
        collectTracks: false,
        onTracksBatch: (tracks) => appendTracks(
          tracks as unknown as Record<string, unknown>[],
        ),
      });
    }

    const committed = await AstraLibraryData.commitRemoteSync(syncId);
    await AstraLibraryData.replaceRemoteUserState(
      source.id,
      source.type,
      favoritePaths,
      remotePlaylists as unknown as Record<string, unknown>[]
    );
    return { tracksScanned: committed.tracksScanned, removed: committed.removed };
  } catch (error) {
    await AstraLibraryData.abortRemoteSync(syncId).catch(() => {});
    throw error;
  }
}

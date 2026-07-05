// Remote catalog sync orchestration (M5). Mirrors src/library/scanner.ts for local
// folders: fetch the server catalog -> upsert into `tracks` -> prune removed tracks.
// The caller (remoteSourcesStore) owns status/progress writes and libraryStore.refresh.

import type { LibraryDatabase } from '@/db/database';
import {
  deleteTracksByPaths,
  getRemoteSourcePaths,
  upsertRemoteTracks,
  type RemoteTrackUpsert,
} from '@/db/queries';
import { addFavoritePaths, syncRemotePlaylists } from '@/db/playlistQueries';
import { buildProvisionalAlbumIdentity, recomputeAlbumIdentity } from '@/library/albumIdentity';
import {
  buildSubsonicTrackPath,
  fetchSubsonicStarredTrackIds,
  syncSubsonicCatalog,
  syncSubsonicPlaylists,
} from '@/services/subsonic';
import { syncJellyfinCatalog, type JellyfinAuthContext } from '@/services/jellyfin';
import type {
  RemoteCatalogTrack,
  RemoteConnectionConfig,
  RemoteSourceRow,
  RemoteSyncProgress,
} from '@/types/remote';

const UPSERT_BATCH = 500;

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

function toUpsertRow(source: RemoteSourceRow, track: RemoteCatalogTrack): RemoteTrackUpsert {
  // Same album identity rule as local tracks so remote/local albums group consistently;
  // the post-sync recompute settles cross-track compilations.
  const albumIdentity = buildProvisionalAlbumIdentity(track.album_artist, track.artist, track.album);
  return {
    path: track.path,
    source_type: source.type,
    source_id: source.id,
    source_track_id: track.source_track_id,
    source_path: track.source_path,
    artwork_source_id: track.artwork_source_id,
    title: track.title,
    artist: track.artist,
    album: track.album,
    album_artist: track.album_artist,
    album_identity_key: albumIdentity.key,
    album_display_artist: albumIdentity.displayArtist,
    duration: track.duration,
    track_number: track.track_number,
    disc_number: track.disc_number,
    year: track.year,
    genre: track.genre,
    format: track.format,
    sample_rate: track.sample_rate,
    bit_depth: track.bit_depth,
    bitrate: track.bitrate,
    channels: track.channels,
    codec: track.codec,
    bpm: track.bpm,
    musical_key: track.musical_key,
  };
}

export async function syncRemoteSource(
  db: LibraryDatabase,
  source: RemoteSourceRow,
  config: RemoteConnectionConfig,
  options: SyncRemoteOptions = {}
): Promise<SyncRemoteResult> {
  options.onProgress?.({ phase: 'connecting', current: 0, total: 0, detail: null });

  let catalogTracks: RemoteCatalogTrack[];
  if (source.type === 'subsonic') {
    const result = await syncSubsonicCatalog(source.id, config, {
      onProgress: options.onProgress,
      signal: options.signal,
    });
    catalogTracks = result.tracks;
  } else {
    const result = await syncJellyfinCatalog(source.id, config, {
      onProgress: options.onProgress,
      authContext: options.authContext,
      signal: options.signal,
    });
    catalogTracks = result.tracks;
  }

  options.onProgress?.({ phase: 'saving', current: 0, total: catalogTracks.length, detail: null });

  const rows = catalogTracks.map((track) => toUpsertRow(source, track));
  for (let i = 0; i < rows.length; i += UPSERT_BATCH) {
    await upsertRemoteTracks(db, rows.slice(i, i + UPSERT_BATCH));
    options.onProgress?.({
      phase: 'saving',
      current: Math.min(i + UPSERT_BATCH, rows.length),
      total: rows.length,
      detail: null,
    });
  }

  // Prune tracks that vanished upstream (favorites/playlists keep their path-keyed
  // entries; they just resolve as missing until re-added — same as local removal).
  const currentPaths = new Set(rows.map((row) => row.path));
  const existing = await getRemoteSourcePaths(db, source.type, source.id);
  const toDelete = existing.map((row) => row.path).filter((path) => !currentPaths.has(path));
  const removed = toDelete.length > 0 ? await deleteTracksByPaths(db, toDelete) : 0;

  // Settle album identities across the whole library (compilation heuristic is
  // cross-track; additions AND removals can change grouping).
  await recomputeAlbumIdentity(db);

  // Subsonic also exposes server favorites + playlists; mirror them into the local
  // favorites/playlists tables (must run after the track upsert so paths resolve).
  if (source.type === 'subsonic') {
    await syncSubsonicFavoritesAndPlaylists(db, source.id, config, options);
  }

  return { tracksScanned: rows.length, removed };
}

async function syncSubsonicFavoritesAndPlaylists(
  db: LibraryDatabase,
  sourceId: number,
  config: RemoteConnectionConfig,
  options: SyncRemoteOptions
): Promise<void> {
  const [starred, playlists] = await Promise.allSettled([
    fetchSubsonicStarredTrackIds(config, { signal: options.signal }),
    syncSubsonicPlaylists(sourceId, config, {
      onProgress: options.onProgress,
      signal: options.signal,
    }),
  ]);

  if (starred.status === 'fulfilled') {
    // Starred ids -> deterministic identity paths; insert-or-ignore (additive, like
    // desktop — un-starring on the server doesn't drop a local favorite).
    const paths = starred.value.map((id) => buildSubsonicTrackPath(sourceId, id));
    await addFavoritePaths(db, paths);
  } else {
    console.warn('[remoteSync] subsonic starred fetch failed', starred.reason);
  }

  if (playlists.status === 'fulfilled') {
    await syncRemotePlaylists(db, sourceId, playlists.value);
  } else {
    console.warn('[remoteSync] subsonic playlist sync failed', playlists.reason);
  }
}

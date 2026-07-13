// Wire types for the desktop<->mobile favorites/playlists LAN sync
// (GET /v1/sync/state, POST /v1/sync/apply on the paired desktop's
// phone-remote server). Mirrors the desktop's src/types/phoneSync.ts.
// Track-level items are keyed by the metadata identity key from
// shared/sync/identity.ts; playlists by sync_uid. Timestamps are wall-clock ms
// and travel verbatim between devices — last-writer-wins merges must never mix
// in the receiving side's clock.

export const DESKTOP_SYNC_FORMAT = 1;

/** Desktop protocol version that introduced /v1/sync/* (and queue/shuffle). */
export const DESKTOP_SYNC_MIN_PROTOCOL_VERSION = 3;

export interface SyncFavorite {
  key: string;
  title: string;
  artist: string;
  album: string;
  addedAt: number;
}

export interface SyncKeyTombstone {
  key: string;
  deletedAt: number;
}

export interface SyncPlaylistEntry {
  title: string;
  artist: string;
  album: string;
  durationSeconds: number | null;
  position: number;
  addedAt: number;
  sourcePath: string | null;
}

export type SyncPlaylistKind = 'normal' | 'dynamic';

export interface SyncPlaylist {
  syncUid: string;
  name: string;
  kind: SyncPlaylistKind;
  dynamicRules: string | null;
  createdAt: number;
  updatedAt: number;
  entries: SyncPlaylistEntry[] | null;
}

export interface SyncPlaylistSnapshot {
  name: string;
  kind: SyncPlaylistKind;
  dynamicRules: string | null;
  updatedAt: number;
  trackCount: number;
  entries: SyncPlaylistEntry[] | null;
}

export interface SyncUidTombstone {
  syncUid: string;
  deletedAt: number;
}

export interface DesktopSyncState {
  syncFormat: number;
  now: number;
  favorites: SyncFavorite[];
  favoriteTombstones: SyncKeyTombstone[];
  playlists: SyncPlaylist[];
  playlistTombstones: SyncUidTombstone[];
  /** Conflict resolutions chosen on the desktop, awaiting this phone. */
  pendingResolutions?: DesktopSyncPendingResolution[];
}

export interface DesktopSyncPendingResolution {
  syncUid: string;
  resolution: DesktopSyncConflictResolution;
  decidedAt: number;
}

/** Phone→desktop conflict report (POST /v1/sync/conflicts) so the desktop can
 *  show conflicts and offer resolutions too. */
export interface DesktopSyncReportedConflict {
  kind: DesktopSyncConflictKind;
  syncUid: string;
  name: string;
  playlistKind: SyncPlaylistKind;
  phoneName: string;
  desktopName: string;
  phoneUpdatedAt: number;
  desktopUpdatedAt: number;
  phoneTrackCount: number;
  desktopTrackCount: number;
  phoneSnapshot?: SyncPlaylistSnapshot | null;
  desktopSnapshot?: SyncPlaylistSnapshot | null;
}

export interface DesktopSyncConflictReportPayload {
  syncFormat: number;
  conflicts: DesktopSyncReportedConflict[];
  /** Uids of desktop-chosen resolutions this phone just applied. */
  consumedResolutions: string[];
}

export interface DesktopSyncApplyPayload {
  syncFormat: number;
  favoriteAdds: SyncFavorite[];
  favoriteRemoves: SyncKeyTombstone[];
  playlistUpserts: SyncPlaylist[];
  playlistDeletes: SyncUidTombstone[];
}

export type DesktopSyncPlaylistApplyStatus = 'created' | 'replaced' | 'deleted' | 'skipped-incompatible';

export interface DesktopSyncPlaylistApplyResult {
  syncUid: string;
  status: DesktopSyncPlaylistApplyStatus;
  entriesMatched: number;
  entriesFallback: number;
}

export interface DesktopSyncApplyResult {
  ok: true;
  favorites: {
    added: number;
    pending: number;
    removed: number;
  };
  playlists: DesktopSyncPlaylistApplyResult[];
}

export type DesktopSyncConflictKind = 'first-pairing' | 'concurrent-edit';

export type DesktopSyncConflictResolution = 'desktop' | 'phone' | 'both' | 'merge';

/**
 * A playlist change sync refuses to resolve automatically: either a
 * first-pairing name collision with divergent contents, or both devices
 * edited the same playlist since the last sync. Sync completes everything
 * else and leaves both copies untouched until the user picks a resolution.
 */
export interface DesktopSyncPlaylistConflict {
  kind: DesktopSyncConflictKind;
  /** The desktop playlist's sync uid (the identity the pair shares/would share). */
  syncUid: string;
  localPlaylistId: number;
  /** The local playlist's own uid at detection (differs from syncUid for first-pairing). */
  localSyncUid: string;
  name: string;
  playlistKind: SyncPlaylistKind;
  localName: string;
  remoteName: string;
  localUpdatedAt: number;
  remoteUpdatedAt: number;
  localTrackCount: number;
  remoteTrackCount: number;
  /** Snapshot of this phone's version at detection (for previews/reporting). */
  local: SyncPlaylist;
  /** Snapshot of the desktop version at detection (for keep-desktop / merge). */
  remote: SyncPlaylist;
}

export interface DesktopSyncSummary {
  favoritesAdded: number;
  favoritesRemoved: number;
  favoritesPending: number;
  playlistsCreated: number;
  playlistsReplaced: number;
  playlistsDeleted: number;
  playlistsSkipped: number;
  entriesFallback: number;
  pushedToDesktop: boolean;
  conflicts: DesktopSyncPlaylistConflict[];
  startedAt: number;
  finishedAt: number;
}

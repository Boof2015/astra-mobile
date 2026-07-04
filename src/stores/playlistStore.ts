import { create } from 'zustand';
import type { DbTrack } from '@/types/library';
import type { Playlist, PlaylistTrackEntry } from '@/types/playlist';
import type {
  DynamicPlaylistPreview,
  DynamicPlaylistRulesV1,
} from '@/shared/playlists/dynamicPlaylist';
import { openLibraryDb, type LibraryDatabase } from '@/db/database';
import { getAllTracks } from '@/db/queries';
import * as playlistDb from '@/db/playlistQueries';
import {
  buildImportIndex,
  decodedDocPath,
  exportPlaylistM3u,
  matchImportEntry,
  normalizeEntryPath,
  pickAndParseM3u,
  type M3uExportResult,
} from '@/library/playlistFiles';
import type { M3uExportEntry } from '@/lib/m3u';

export interface M3uImportSummary {
  playlistId: number;
  name: string;
  total: number;
  matchedByPath: number;
  matchedByMetadata: number;
  missing: number;
  ambiguous: number;
}

/**
 * Playlists + favorites state — SQLite is the source of truth (no persist);
 * every mutation re-queries. libraryStore.refresh() chains into refresh() so
 * scans and folder removals update counts/missing states.
 */
interface PlaylistStore {
  playlists: Playlist[];
  favoritePaths: Set<string>;
  favoriteTracks: DbTrack[];
  activePlaylistId: number | null;
  activeEntries: PlaylistTrackEntry[];

  refresh: () => Promise<void>;
  openPlaylist: (id: number) => Promise<void>;
  closePlaylist: () => void;
  createPlaylist: (name: string) => Promise<Playlist>;
  createDynamicPlaylist: (name: string, rules: DynamicPlaylistRulesV1) => Promise<Playlist>;
  getDynamicPlaylistRules: (id: number) => Promise<DynamicPlaylistRulesV1>;
  updateDynamicPlaylistRules: (id: number, rules: DynamicPlaylistRulesV1) => Promise<void>;
  previewDynamicPlaylist: (rules: DynamicPlaylistRulesV1) => Promise<DynamicPlaylistPreview>;
  renamePlaylist: (id: number, name: string) => Promise<void>;
  deletePlaylist: (id: number) => Promise<void>;
  addTracksToPlaylist: (id: number, tracks: DbTrack[]) => Promise<number>;
  removeFromPlaylist: (id: number, trackPath: string) => Promise<void>;
  moveTrack: (id: number, trackPath: string, direction: -1 | 1) => Promise<void>;
  // Only the path is read; accepts a library DbTrack or the now-playing Track.
  toggleFavorite: (track: { path: string }) => Promise<void>;
  markPlayed: (id: number) => Promise<void>;
  importM3u: () => Promise<M3uImportSummary | null>;
  exportM3u: (target: number | 'favorites') => Promise<M3uExportResult | null>;
}

function trackToExportEntry(track: DbTrack): M3uExportEntry {
  return {
    path: decodedDocPath(track.path) ?? track.file_name,
    title: track.title,
    artist: track.artist,
    duration: track.duration,
  };
}

function entryToExportEntry(entry: PlaylistTrackEntry): M3uExportEntry {
  if (entry.track) return trackToExportEntry(entry.track);
  return {
    path: decodedDocPath(entry.track_path) ?? entry.track_path,
    title: entry.fallback_title,
    artist: entry.fallback_artist,
    duration: null,
  };
}

export const usePlaylistStore = create<PlaylistStore>((set, get) => {
  const reloadActive = async (db: LibraryDatabase) => {
    const id = get().activePlaylistId;
    if (id == null) return;
    const activeEntries = await playlistDb.getPlaylistEntries(db, id);
    set({ activeEntries });
  };

  const refreshWith = async (db: LibraryDatabase) => {
    const [playlists, favoritePathList, favoriteTracks] = await Promise.all([
      playlistDb.getPlaylists(db),
      playlistDb.getFavoritePaths(db),
      playlistDb.getFavoriteTracks(db),
    ]);
    set({ playlists, favoritePaths: new Set(favoritePathList), favoriteTracks });
    await reloadActive(db);
  };

  return {
    playlists: [],
    favoritePaths: new Set<string>(),
    favoriteTracks: [],
    activePlaylistId: null,
    activeEntries: [],

    refresh: async () => {
      const db = await openLibraryDb();
      await refreshWith(db);
    },

    openPlaylist: async (id) => {
      const db = await openLibraryDb();
      const activeEntries = await playlistDb.getPlaylistEntries(db, id);
      set({ activePlaylistId: id, activeEntries });
    },

    closePlaylist: () => set({ activePlaylistId: null, activeEntries: [] }),

    createPlaylist: async (name) => {
      const db = await openLibraryDb();
      const playlist = await playlistDb.createPlaylist(db, name);
      await refreshWith(db);
      return playlist;
    },

    createDynamicPlaylist: async (name, rules) => {
      const db = await openLibraryDb();
      const playlist = await playlistDb.createDynamicPlaylist(db, name, rules);
      await refreshWith(db);
      return playlist;
    },

    getDynamicPlaylistRules: async (id) => {
      const db = await openLibraryDb();
      return playlistDb.getDynamicPlaylistRules(db, id);
    },

    updateDynamicPlaylistRules: async (id, rules) => {
      const db = await openLibraryDb();
      await playlistDb.updateDynamicPlaylistRules(db, id, rules);
      await refreshWith(db);
    },

    previewDynamicPlaylist: async (rules) => {
      const db = await openLibraryDb();
      return playlistDb.previewDynamicPlaylist(db, rules);
    },

    renamePlaylist: async (id, name) => {
      const db = await openLibraryDb();
      await playlistDb.renamePlaylist(db, id, name);
      await refreshWith(db);
    },

    deletePlaylist: async (id) => {
      const db = await openLibraryDb();
      await playlistDb.deletePlaylist(db, id);
      if (get().activePlaylistId === id) {
        set({ activePlaylistId: null, activeEntries: [] });
      }
      await refreshWith(db);
    },

    addTracksToPlaylist: async (id, tracks) => {
      const db = await openLibraryDb();
      const inserted = await playlistDb.addPlaylistEntries(
        db,
        id,
        tracks.map((track) => ({
          trackPath: track.path,
          fallbackTitle: track.title,
          fallbackArtist: track.artist,
          fallbackAlbum: track.album,
        }))
      );
      await refreshWith(db);
      return inserted;
    },

    removeFromPlaylist: async (id, trackPath) => {
      const db = await openLibraryDb();
      await playlistDb.removeFromPlaylist(db, id, trackPath);
      await refreshWith(db);
    },

    moveTrack: async (id, trackPath, direction) => {
      const db = await openLibraryDb();
      await playlistDb.movePlaylistTrack(db, id, trackPath, direction);
      await refreshWith(db);
    },

    toggleFavorite: async (track) => {
      const wasFavorite = get().favoritePaths.has(track.path);
      // Optimistic Set swap (always a fresh Set — never mutate in place).
      const optimistic = new Set(get().favoritePaths);
      if (wasFavorite) {
        optimistic.delete(track.path);
      } else {
        optimistic.add(track.path);
      }
      set({ favoritePaths: optimistic });

      const db = await openLibraryDb();
      if (wasFavorite) {
        await playlistDb.removeFavorite(db, track.path);
      } else {
        await playlistDb.addFavorite(db, track.path);
      }
      const [favoritePathList, favoriteTracks] = await Promise.all([
        playlistDb.getFavoritePaths(db),
        playlistDb.getFavoriteTracks(db),
      ]);
      set({ favoritePaths: new Set(favoritePathList), favoriteTracks });
    },

    markPlayed: async (id) => {
      const db = await openLibraryDb();
      await playlistDb.markPlaylistPlayed(db, id);
      const playlists = await playlistDb.getPlaylists(db);
      set({ playlists });
    },

    importM3u: async () => {
      const picked = await pickAndParseM3u();
      if (!picked) return null;

      const db = await openLibraryDb();
      const index = buildImportIndex(await getAllTracks(db));

      const summary: Omit<M3uImportSummary, 'playlistId'> = {
        name: picked.name,
        total: picked.entries.length,
        matchedByPath: 0,
        matchedByMetadata: 0,
        missing: 0,
        ambiguous: 0,
      };
      const inserts: playlistDb.PlaylistEntryInsert[] = [];
      for (const entry of picked.entries) {
        const match = matchImportEntry(entry, index);
        if (match.kind === 'matched') {
          if (match.via === 'path') {
            summary.matchedByPath += 1;
          } else {
            summary.matchedByMetadata += 1;
          }
          inserts.push({
            trackPath: match.track.path,
            fallbackTitle: match.track.title,
            fallbackArtist: match.track.artist,
            fallbackAlbum: match.track.album,
          });
        } else {
          // Preserve unmatched entries as "missing" rows (desktop model).
          summary.missing += 1;
          if (match.kind === 'ambiguous') summary.ambiguous += 1;
          inserts.push({
            trackPath: normalizeEntryPath(entry.path),
            fallbackTitle: entry.title ?? null,
            fallbackArtist: entry.artist ?? null,
          });
        }
      }

      const playlist = await playlistDb.createPlaylist(db, picked.name);
      await playlistDb.addPlaylistEntries(db, playlist.id, inserts);
      await refreshWith(db);
      return { ...summary, playlistId: playlist.id };
    },

    exportM3u: async (target) => {
      const db = await openLibraryDb();
      let name: string;
      let entries: M3uExportEntry[];
      if (target === 'favorites') {
        name = 'Favorites';
        entries = get().favoriteTracks.map(trackToExportEntry);
      } else {
        name = get().playlists.find((playlist) => playlist.id === target)?.name ?? 'Playlist';
        const playlistEntries = await playlistDb.getPlaylistEntries(db, target);
        entries = playlistEntries.map(entryToExportEntry);
      }
      return exportPlaylistM3u(name, entries);
    },
  };
});

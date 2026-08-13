import { create } from 'zustand';
import { AstraLibraryData } from '../../modules/astra-library-scanner';
import type { DbTrack } from '@/types/library';
import type { Playlist, PlaylistTrackEntry } from '@/types/playlist';
import {
  createDefaultDynamicPlaylistRules,
  normalizeDynamicPlaylistRules,
  type DynamicPlaylistPreview,
  type DynamicPlaylistRulesV1,
} from '@/shared/playlists/dynamicPlaylist';
import {
  buildImportIndex,
  decodedDocPath,
  exportPlaylistM3u,
  matchImportEntry,
  normalizeEntryPath,
  pickAndParseM3u,
  type M3uExportResult,
} from '@/library/playlistFiles';
import type { M3uExportEntry, M3uEntry } from '@/lib/m3u';

const ENTRY_PAGE_SIZE = 100;

export interface M3uImportSummary {
  playlistId: number;
  name: string;
  total: number;
  matchedByPath: number;
  matchedByMetadata: number;
  missing: number;
  ambiguous: number;
}

interface PlaylistStore {
  playlists: Playlist[];
  favoritePaths: Set<string>;
  favoriteTracks: DbTrack[];
  activePlaylistId: number | null;
  activeEntries: PlaylistTrackEntry[];
  activeEntriesTotal: number;
  activeEntriesNextOffset: number | null;

  refresh: () => Promise<void>;
  openPlaylist: (id: number) => Promise<void>;
  loadNextEntries: () => Promise<void>;
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

function parseRules(raw: string): DynamicPlaylistRulesV1 {
  try {
    return normalizeDynamicPlaylistRules(JSON.parse(raw));
  } catch {
    return createDefaultDynamicPlaylistRules();
  }
}

async function candidatesForImport(entry: M3uEntry): Promise<DbTrack[]> {
  const exact = await AstraLibraryData.getTrack<DbTrack>(entry.path).catch(() => null);
  if (exact) return [exact];
  const term = entry.title?.trim() || entry.path.split(/[\\/]/).pop()?.replace(/\.[^.]+$/, '') || '';
  return term ? AstraLibraryData.searchTracks<DbTrack>(term, 50) : [];
}

export const usePlaylistStore = create<PlaylistStore>((set, get) => {
  const reloadActive = async () => {
    const id = get().activePlaylistId;
    if (id == null) return;
    const page = await AstraLibraryData.getPlaylistEntries<PlaylistTrackEntry>(
      id,
      0,
      ENTRY_PAGE_SIZE
    );
    set({
      activeEntries: page.items,
      activeEntriesTotal: page.totalCount,
      activeEntriesNextOffset: page.nextOffset,
    });
  };

  const refreshAll = async () => {
    const [playlists, favoritePaths, favoriteTracks] = await Promise.all([
      AstraLibraryData.listPlaylists<Playlist>(),
      AstraLibraryData.getFavoritePaths(),
      AstraLibraryData.getFavoriteTracks<DbTrack>(500),
    ]);
    set({ playlists, favoritePaths: new Set(favoritePaths), favoriteTracks });
    await reloadActive();
  };

  return {
    playlists: [],
    favoritePaths: new Set<string>(),
    favoriteTracks: [],
    activePlaylistId: null,
    activeEntries: [],
    activeEntriesTotal: 0,
    activeEntriesNextOffset: null,

    refresh: refreshAll,

    openPlaylist: async (id) => {
      set({ activePlaylistId: id, activeEntries: [], activeEntriesNextOffset: 0 });
      await reloadActive();
    },

    loadNextEntries: async () => {
      const id = get().activePlaylistId;
      const offset = get().activeEntriesNextOffset;
      if (id == null || offset == null) return;
      const page = await AstraLibraryData.getPlaylistEntries<PlaylistTrackEntry>(
        id,
        offset,
        ENTRY_PAGE_SIZE
      );
      set((state) => ({
        activeEntries: [...state.activeEntries, ...page.items],
        activeEntriesTotal: page.totalCount,
        activeEntriesNextOffset: page.nextOffset,
      }));
    },

    closePlaylist: () =>
      set({
        activePlaylistId: null,
        activeEntries: [],
        activeEntriesTotal: 0,
        activeEntriesNextOffset: null,
      }),

    createPlaylist: async (name) => {
      const playlist = await AstraLibraryData.createPlaylist<Playlist>(name, 'normal', null);
      await refreshAll();
      return playlist;
    },

    createDynamicPlaylist: async (name, rules) => {
      const normalized = normalizeDynamicPlaylistRules(rules);
      const playlist = await AstraLibraryData.createPlaylist<Playlist>(
        name,
        'dynamic',
        JSON.stringify(normalized)
      );
      await refreshAll();
      return playlist;
    },

    getDynamicPlaylistRules: async (id) =>
      parseRules(await AstraLibraryData.getDynamicPlaylistRules(id)),

    updateDynamicPlaylistRules: async (id, rules) => {
      await AstraLibraryData.updateDynamicPlaylistRules(
        id,
        JSON.stringify(normalizeDynamicPlaylistRules(rules))
      );
      await refreshAll();
    },

    previewDynamicPlaylist: async (rules) =>
      AstraLibraryData.previewDynamicPlaylist<DynamicPlaylistPreview>(
        JSON.stringify(normalizeDynamicPlaylistRules(rules))
      ),

    renamePlaylist: async (id, name) => {
      await AstraLibraryData.renamePlaylist(id, name);
      await refreshAll();
    },

    deletePlaylist: async (id) => {
      await AstraLibraryData.deletePlaylist(id);
      if (get().activePlaylistId === id) get().closePlaylist();
      await refreshAll();
    },

    addTracksToPlaylist: async (id, tracks) => {
      const inserted = await AstraLibraryData.addPlaylistEntries(
        id,
        tracks.map((track) => ({
          trackPath: track.path,
          fallbackTitle: track.title,
          fallbackArtist: track.artist,
          fallbackAlbum: track.album,
        }))
      );
      await refreshAll();
      return inserted;
    },

    removeFromPlaylist: async (id, trackPath) => {
      await AstraLibraryData.removePlaylistEntry(id, trackPath);
      await refreshAll();
    },

    moveTrack: async (id, trackPath, direction) => {
      await AstraLibraryData.movePlaylistEntry(id, trackPath, direction);
      await refreshAll();
    },

    toggleFavorite: async (track) => {
      const favorite = !get().favoritePaths.has(track.path);
      const optimistic = new Set(get().favoritePaths);
      if (favorite) optimistic.add(track.path);
      else optimistic.delete(track.path);
      set({ favoritePaths: optimistic });
      await AstraLibraryData.setFavorite(track.path, favorite);
      const [paths, tracks] = await Promise.all([
        AstraLibraryData.getFavoritePaths(),
        AstraLibraryData.getFavoriteTracks<DbTrack>(500),
      ]);
      set({ favoritePaths: new Set(paths), favoriteTracks: tracks });
    },

    markPlayed: async (id) => {
      await AstraLibraryData.markPlaylistPlayed(id);
      set({ playlists: await AstraLibraryData.listPlaylists<Playlist>() });
    },

    importM3u: async () => {
      const picked = await pickAndParseM3u();
      if (!picked) return null;
      const summary: Omit<M3uImportSummary, 'playlistId'> = {
        name: picked.name,
        total: picked.entries.length,
        matchedByPath: 0,
        matchedByMetadata: 0,
        missing: 0,
        ambiguous: 0,
      };
      const inserts: Parameters<typeof AstraLibraryData.addPlaylistEntries>[1] = [];
      for (const entry of picked.entries) {
        const candidates = await candidatesForImport(entry);
        const match = matchImportEntry(entry, buildImportIndex(candidates));
        if (match.kind === 'matched') {
          if (match.via === 'path') summary.matchedByPath += 1;
          else summary.matchedByMetadata += 1;
          inserts.push({
            trackPath: match.track.path,
            fallbackTitle: match.track.title,
            fallbackArtist: match.track.artist,
            fallbackAlbum: match.track.album,
          });
        } else {
          summary.missing += 1;
          if (match.kind === 'ambiguous') summary.ambiguous += 1;
          inserts.push({
            trackPath: normalizeEntryPath(entry.path),
            fallbackTitle: entry.title ?? null,
            fallbackArtist: entry.artist ?? null,
          });
        }
      }
      const playlist = await AstraLibraryData.createPlaylist<Playlist>(picked.name, 'normal', null);
      await AstraLibraryData.addPlaylistEntries(playlist.id, inserts);
      await refreshAll();
      return { ...summary, playlistId: playlist.id };
    },

    exportM3u: async (target) => {
      let name: string;
      let entries: M3uExportEntry[];
      if (target === 'favorites') {
        name = 'Favorites';
        entries = get().favoriteTracks.map(trackToExportEntry);
      } else {
        name = get().playlists.find((playlist) => playlist.id === target)?.name ?? 'Playlist';
        const all: PlaylistTrackEntry[] = [];
        let offset = 0;
        while (true) {
          const page = await AstraLibraryData.getPlaylistEntries<PlaylistTrackEntry>(
            target,
            offset,
            200
          );
          all.push(...page.items);
          if (page.nextOffset == null) break;
          offset = page.nextOffset;
        }
        entries = all.map(entryToExportEntry);
      }
      return exportPlaylistM3u(name, entries);
    },
  };
});

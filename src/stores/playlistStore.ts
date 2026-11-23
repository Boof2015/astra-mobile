import { create } from 'zustand';
import { AstraLibraryData } from '../../modules/astra-library-scanner';
import type { DbTrack } from '@/types/library';
import type { Playlist, PlaylistSummary, PlaylistTrackEntry } from '@/types/playlist';
import {
  serializeDynamicPlaylistRules,
  normalizeDynamicPlaylistRules,
  type DynamicPlaylistPreview,
  type DynamicPlaylistRulesV2,
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

type CollectionId = number | 'favorites';

interface PlaylistStore {
  playlists: Playlist[];
  favoritePaths: Set<string>;
  favoriteTracks: DbTrack[];
  favoriteSummary: PlaylistSummary | null;
  activePlaylistId: CollectionId | null;
  activeEntries: PlaylistTrackEntry[];
  activeEntriesTotal: number;
  activeEntriesNextOffset: number | null;

  refresh: () => Promise<void>;
  openPlaylist: (id: CollectionId) => Promise<void>;
  loadNextEntries: () => Promise<void>;
  closePlaylist: () => void;
  createPlaylist: (name: string) => Promise<Playlist>;
  createDynamicPlaylist: (name: string, rules: DynamicPlaylistRulesV2) => Promise<Playlist>;
  getDynamicPlaylistRules: (id: number) => Promise<DynamicPlaylistRulesV2>;
  updateDynamicPlaylistRules: (id: number, rules: DynamicPlaylistRulesV2) => Promise<void>;
  previewDynamicPlaylist: (rules: DynamicPlaylistRulesV2) => Promise<DynamicPlaylistPreview>;
  renamePlaylist: (id: number, name: string) => Promise<void>;
  deletePlaylist: (id: number) => Promise<void>;
  addTracksToPlaylist: (id: number, tracks: DbTrack[]) => Promise<number>;
  removeFromPlaylist: (id: number, trackPath: string) => Promise<void>;
  moveTrack: (id: number, trackPath: string, direction: -1 | 1) => Promise<void>;
  toggleFavorite: (track: { path: string }) => Promise<void>;
  removeFavorite: (path: string) => Promise<void>;
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

function parseRules(raw: string): DynamicPlaylistRulesV2 {
  return normalizeDynamicPlaylistRules(JSON.parse(raw));
}

async function candidatesForImport(entry: M3uEntry): Promise<DbTrack[]> {
  const exact = await AstraLibraryData.getTrack<DbTrack>(entry.path).catch(() => null);
  if (exact) return [exact];
  const term = entry.title?.trim() || entry.path.split(/[\\/]/).pop()?.replace(/\.[^.]+$/, '') || '';
  return term ? AstraLibraryData.searchTracks<DbTrack>(term, 50) : [];
}

export const usePlaylistStore = create<PlaylistStore>((set, get) => {
  let pageVersion = 0;
  let loadingPage = false;
  const readPage = (id: CollectionId, offset: number) => id === 'favorites'
    ? AstraLibraryData.getFavoriteEntries<PlaylistTrackEntry>(offset, ENTRY_PAGE_SIZE)
    : AstraLibraryData.getPlaylistEntries<PlaylistTrackEntry>(id, offset, ENTRY_PAGE_SIZE);

  const reloadActive = async () => {
    const { activePlaylistId: id, activeEntries } = get();
    const version = ++pageVersion;
    loadingPage = false;
    if (id == null) return;
    loadingPage = true;
    try {
      const keepCount = id === 'favorites' ? activeEntries.length : 0;
      let page = await readPage(id, 0);
      const entries = [...page.items];
      while (version === pageVersion && entries.length < keepCount && page.nextOffset != null) {
        page = await readPage(id, page.nextOffset);
        entries.push(...page.items);
      }
      if (version !== pageVersion) return;
      set({ activeEntries: entries, activeEntriesTotal: page.totalCount, activeEntriesNextOffset: page.nextOffset });
    } finally {
      if (version === pageVersion) loadingPage = false;
    }
  };

  const refreshAll = async () => {
    const [playlists, favoritePaths, favoriteTracks, favoriteSummary] = await Promise.all([
      AstraLibraryData.listPlaylists<Playlist>(),
      AstraLibraryData.getFavoritePaths(),
      AstraLibraryData.getFavoriteTracks<DbTrack>(500),
      AstraLibraryData.getFavoriteSummary<PlaylistSummary>(),
    ]);
    set({ playlists, favoritePaths: new Set(favoritePaths), favoriteTracks, favoriteSummary });
    await reloadActive();
  };

  const setFavorite = async (path: string, favorite: boolean) => {
    const optimistic = new Set(get().favoritePaths);
    if (favorite) optimistic.add(path);
    else optimistic.delete(path);
    set({ favoritePaths: optimistic });
    try {
      await AstraLibraryData.setFavorite(path, favorite);
    } catch (error) {
      const saved = await AstraLibraryData.getFavoritePaths();
      set({ favoritePaths: new Set(saved) });
      throw error;
    }
    const [paths, tracks, favoriteSummary] = await Promise.all([
      AstraLibraryData.getFavoritePaths(),
      AstraLibraryData.getFavoriteTracks<DbTrack>(500),
      AstraLibraryData.getFavoriteSummary<PlaylistSummary>(),
    ]);
    set({ favoritePaths: new Set(paths), favoriteTracks: tracks, favoriteSummary });
    if (get().activePlaylistId === 'favorites') await reloadActive();
  };

  return {
    playlists: [],
    favoritePaths: new Set<string>(),
    favoriteTracks: [],
    favoriteSummary: null,
    activePlaylistId: null,
    activeEntries: [],
    activeEntriesTotal: 0,
    activeEntriesNextOffset: null,

    refresh: refreshAll,

    openPlaylist: async (id) => {
      set({ activePlaylistId: id, activeEntries: [], activeEntriesTotal: 0, activeEntriesNextOffset: null });
      await reloadActive();
    },

    loadNextEntries: async () => {
      const { activePlaylistId: id, activeEntriesNextOffset: offset } = get();
      if (id == null || offset == null || loadingPage) return;
      const version = pageVersion;
      loadingPage = true;
      try {
        const page = await readPage(id, offset);
        if (version !== pageVersion || offset !== get().activeEntriesNextOffset) return;
        set((state) => ({
          activeEntries: [...state.activeEntries, ...page.items],
          activeEntriesTotal: page.totalCount,
          activeEntriesNextOffset: page.nextOffset,
        }));
      } finally {
        if (version === pageVersion) loadingPage = false;
      }
    },

    closePlaylist: () => {
      pageVersion++;
      set({ activePlaylistId: null, activeEntries: [], activeEntriesTotal: 0, activeEntriesNextOffset: null });
    },

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
        serializeDynamicPlaylistRules(normalized)
      );
      await refreshAll();
      return playlist;
    },

    getDynamicPlaylistRules: async (id) =>
      parseRules(await AstraLibraryData.getDynamicPlaylistRules(id)),

    updateDynamicPlaylistRules: async (id, rules) => {
      await AstraLibraryData.updateDynamicPlaylistRules(
        id,
        serializeDynamicPlaylistRules(rules)
      );
      await refreshAll();
    },

    previewDynamicPlaylist: async (rules) =>
      AstraLibraryData.previewDynamicPlaylist<DynamicPlaylistPreview>(
        serializeDynamicPlaylistRules(rules)
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

    toggleFavorite: (track) => setFavorite(track.path, !get().favoritePaths.has(track.path)),
    removeFavorite: (path) => setFavorite(path, false),

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

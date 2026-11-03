import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import ts from 'typescript';
import type { Playlist, PlaylistSummary, PlaylistTrackEntry } from '../types/playlist.ts';
import type { DbTrack } from '../types/library.ts';

const require = createRequire(import.meta.url);
const compiledSources = new Map<string, string>();

function playlist(id: number, name: string): Playlist {
  return {
    id, name, kind: 'normal', created_at: id, updated_at: id,
    last_played_at: null, auto_cover_hash: null, track_count: 2,
    missing_track_count: 0, total_duration: 360, remote_source_id: null,
  };
}

function savedData() {
  return {
    playlists: [playlist(2, 'Second playlist'), playlist(1, 'First playlist')],
    favoritePaths: ['content://music/one', 'content://music/missing'],
    // Refresh passes native track rows through without reading other fields.
    favoriteTracks: [
      { id: 1, path: 'content://music/one', title: 'Favorite track' },
    ] as Pick<DbTrack, 'id' | 'path' | 'title'>[],
    favoriteSummary: { track_count: 1, missing_track_count: 1, total_duration: 180 } as PlaylistSummary,
  };
}

// Execute both real stores, including their refresh and event wiring. Each
// harness gets fresh module state while the supplied native data survives it.
function harness(data = savedData(), status = 'ready') {
  const modules = new Map<string, Record<string, any>>();
  const listeners = new Map<string, () => void>();
  const calls = { playlists: 0, favoritePaths: 0, favoriteTracks: 0, favoriteSummary: 0 };
  const emptyPage = async () => ({ items: [], nextCursor: null, totalCount: 0 });
  const native = {
    initialize: async () => ({ status, trackCount: 0, recoveryNotice: null }),
    getSettings: async () => ({}),
    setSettings: async () => {},
    addListener: (event: string, listener: () => void) => {
      listeners.set(event, listener);
      return { remove: () => listeners.delete(event) };
    },
    getTrackPage: emptyPage,
    getAlbumPage: emptyPage,
    getArtistPage: emptyPage,
    getRecentlyPlayed: async () => [],
    getSectionAnchors: async () => [],
    listPlaylists: async () => { calls.playlists++; return [...data.playlists]; },
    getFavoritePaths: async () => { calls.favoritePaths++; return [...data.favoritePaths]; },
    getFavoriteTracks: async () => { calls.favoriteTracks++; return [...data.favoriteTracks]; },
    getFavoriteSummary: async () => { calls.favoriteSummary++; return { ...data.favoriteSummary }; },
    getPlaylistEntries: async (_id: number, _offset: number, _limit: number): Promise<{
      items: PlaylistTrackEntry[]; totalCount: number; nextOffset: number | null;
    }> => ({ items: [], totalCount: 0, nextOffset: null }),
    setFavorite: async (_path: string, _favorite: boolean) => {},
    removePlaylistEntry: async (_id: number, _path: string) => {},
  };
  const settings = {
    getState: () => ({ load: async () => {}, includeSingles: false, artistGroupingMode: 'album_artist' }),
    subscribe: () => () => {},
  };

  function load(file: URL): Record<string, any> {
    const cached = modules.get(file.href);
    if (cached) return cached;
    const exports: Record<string, any> = {};
    modules.set(file.href, exports);
    let source = compiledSources.get(file.href);
    if (!source) {
      source = ts.transpileModule(readFileSync(file, 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
      }).outputText;
      compiledSources.set(file.href, source);
    }
    const imports = (name: string) => {
      if (name === 'zustand') return require(name);
      if (name.endsWith('modules/astra-library-scanner')) return { AstraLibraryData: native };
      if (name === './settingsStore') return { useSettingsStore: settings };
      if (name === '@/library/scanner') return { loadFolders: async () => [] };
      if (['@/library/scanService', '@/library/artistImageLookup', '@/library/playlistFiles'].includes(name)) return {};
      if (name.startsWith('@/')) {
        return load(new URL(`../${name.slice(2)}${name.endsWith('.ts') ? '' : '.ts'}`, import.meta.url));
      }
      if (name.startsWith('.')) {
        return load(new URL(`${name}${name.endsWith('.ts') ? '' : '.ts'}`, file));
      }
      throw new Error(`Unexpected dependency ${name}`);
    };
    new Function('require', 'exports', source)(imports, exports);
    return exports;
  }

  const { usePlaylistStore } = load(new URL('./playlistStore.ts', import.meta.url)) as typeof import('./playlistStore.ts');
  const { useLibraryStore } = load(new URL('./libraryStore.ts', import.meta.url)) as typeof import('./libraryStore.ts');
  return { data, native, calls, listeners, playlists: usePlaylistStore, library: useLibraryStore };
}

function assertLoaded(h: ReturnType<typeof harness>) {
  const state = h.playlists.getState();
  assert.deepEqual(state.playlists, h.data.playlists);
  assert.deepEqual(state.favoritePaths, new Set(h.data.favoritePaths));
  assert.deepEqual(state.favoriteTracks, h.data.favoriteTracks);
  assert.deepEqual(state.favoriteSummary, h.data.favoriteSummary);
}

test('library initialization loads saved playlists and favorites without a mutation', async () => {
  const h = harness();
  assert.deepEqual(h.playlists.getState().playlists, []);
  await h.library.getState().initialize();
  assert.equal(h.library.getState().initialized, true);
  assertLoaded(h);
  assert.deepEqual(h.calls, { playlists: 1, favoritePaths: 1, favoriteTracks: 1, favoriteSummary: 1 });
});

test('initialization awaits playlist loading alongside catalog reads', async () => {
  const h = harness();
  let release!: () => void;
  const pendingRead = new Promise<void>((resolve) => { release = resolve; });
  const listPlaylists = h.native.listPlaylists;
  h.native.listPlaylists = async () => { await pendingRead; return listPlaylists(); };
  const initializing = h.library.getState().initialize();
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(h.library.getState().initialized, false);
  assert.equal(h.calls.favoritePaths, 1);
  release();
  await initializing;
  assertLoaded(h);
});

test('fresh stores restore the same saved playlists after process recreation', async () => {
  const data = savedData();
  const first = harness(data);
  await first.library.getState().initialize();
  const restarted = harness(data);
  assert.notEqual(first.playlists, restarted.playlists);
  assert.deepEqual(restarted.playlists.getState().playlists, []);
  await restarted.library.getState().initialize();
  assertLoaded(restarted);
});

test('catalog changes refresh playlist counts, artwork, and favorite tracks', { timeout: 5000 }, async () => {
  const h = harness();
  await h.library.getState().initialize();
  h.data.playlists = h.data.playlists.map((row) => ({
    ...row, track_count: 1, missing_track_count: 1, total_duration: 123, auto_cover_hash: 'new-cover',
  }));
  h.data.favoritePaths = ['content://music/two'];
  h.data.favoriteTracks = [{ id: 2, path: 'content://music/two', title: 'New favorite' }];
  h.data.favoriteSummary = { track_count: 1, missing_track_count: 0, total_duration: 123 };
  const refreshed = new Promise<void>((resolve) => {
    const unsubscribe = h.library.subscribe((state, previous) => {
      if (state.homeAlbums !== previous.homeAlbums) {
        unsubscribe();
        resolve();
      }
    });
  });
  const onCatalogChanged = h.listeners.get('onCatalogChanged');
  assert.ok(onCatalogChanged);
  onCatalogChanged();
  await refreshed;
  assertLoaded(h);
  assert.equal(h.calls.playlists, 2);
});

test('failed playlist reads retain loaded data and the next library refresh recovers', async () => {
  const h = harness();
  await h.library.getState().initialize();
  const previous = h.playlists.getState();
  const listPlaylists = h.native.listPlaylists;
  h.native.listPlaylists = async () => { throw new Error('playlist read failed'); };
  h.data.playlists = [...h.data.playlists, playlist(3, 'Another saved playlist')];
  h.data.favoritePaths = [];
  h.data.favoriteTracks = [];
  await assert.rejects(h.library.getState().refresh(), /playlist read failed/);
  assert.equal(h.playlists.getState().playlists, previous.playlists);
  assert.equal(h.playlists.getState().favoritePaths, previous.favoritePaths);
  assert.equal(h.playlists.getState().favoriteTracks, previous.favoriteTracks);
  assert.equal(h.playlists.getState().favoriteSummary, previous.favoriteSummary);
  h.native.listPlaylists = listPlaylists;
  await h.library.getState().refresh();
  assertLoaded(h);
});

test('failed initial playlist loading can be retried through library initialization', async () => {
  const h = harness();
  const listPlaylists = h.native.listPlaylists;
  h.native.listPlaylists = async () => { throw new Error('playlist read failed'); };
  await assert.rejects(h.library.getState().initialize(), /playlist read failed/);
  assert.equal(h.library.getState().initialized, false);
  h.native.listPlaylists = listPlaylists;
  await h.library.getState().initialize();
  assert.equal(h.library.getState().initialized, true);
  assertLoaded(h);
});

test('an empty database loads an empty playlist and favorites state', async () => {
  const h = harness({ playlists: [], favoritePaths: [], favoriteTracks: [],
    favoriteSummary: { track_count: 0, missing_track_count: 0, total_duration: 0 },
  }, 'empty');
  await h.library.getState().initialize();
  assertLoaded(h);
  assert.equal(h.calls.playlists, 1);
});

test('fatal user data skips playlist and favorites reads', async () => {
  const h = harness(savedData(), 'fatalUserData');
  await h.library.getState().initialize();
  assert.equal(h.library.getState().initialized, true);
  assert.equal(h.library.getState().status, 'fatalUserData');
  assert.deepEqual(h.calls, { playlists: 0, favoritePaths: 0, favoriteTracks: 0, favoriteSummary: 0 });
  assert.deepEqual(h.playlists.getState().playlists, []);
  assert.equal(h.playlists.getState().favoriteSummary, null);
});

test('235-track playlist totals survive entry pagination and refresh after removal', async () => {
  const h = harness();
  h.data.playlists = [{ ...playlist(1, 'Large playlist'), track_count: 235, total_duration: 42300 }];
  h.native.getPlaylistEntries = async (_id, offset, limit) => ({
    items: Array.from({ length: Math.min(limit, 235 - offset) }, (_, i) => ({ id: offset + i })) as PlaylistTrackEntry[],
    totalCount: 235,
    nextOffset: offset + limit < 235 ? offset + limit : null,
  });
  await h.playlists.getState().refresh();
  const summary = h.playlists.getState().playlists[0];
  await h.playlists.getState().openPlaylist(1);
  assert.equal(h.playlists.getState().activeEntries.length, 100);
  assert.equal(h.playlists.getState().playlists[0].track_count, 235);
  await h.playlists.getState().loadNextEntries();
  assert.equal(h.playlists.getState().activeEntries.length, 200);
  assert.equal(h.playlists.getState().playlists[0], summary);
  await h.playlists.getState().loadNextEntries();
  assert.equal(h.playlists.getState().activeEntries.length, 235);
  assert.equal(h.playlists.getState().playlists[0], summary);
  h.native.removePlaylistEntry = async () => {
    h.data.playlists = [{ ...summary, track_count: 234, total_duration: 42120 }];
  };
  await h.playlists.getState().removeFromPlaylist(1, 'removed');
  assert.equal(h.playlists.getState().playlists[0].track_count, 234);
  assert.equal(h.playlists.getState().playlists[0].total_duration, 42120);
});

test('Favorites totals are independent of the 500 loaded rows and refresh on toggles', async () => {
  const h = harness();
  assert.equal(h.playlists.getState().favoriteSummary, null);
  h.data.favoritePaths = Array.from({ length: 606 }, (_, i) => `track:${i}`);
  h.data.favoriteTracks = h.data.favoritePaths.slice(0, 500).map((path, id) => ({ id, path, title: path }));
  h.data.favoriteSummary = { track_count: 605, missing_track_count: 1, total_duration: 108900 };
  await h.playlists.getState().refresh();
  assert.equal(h.playlists.getState().favoriteTracks.length, 500);
  assertLoaded(h);
  h.native.setFavorite = async (path, favorite) => {
    assert.equal(favorite, false);
    h.data.favoritePaths = h.data.favoritePaths.filter(value => value !== path);
    h.data.favoriteSummary = { track_count: 604, missing_track_count: 1, total_duration: 108720 };
  };
  await h.playlists.getState().toggleFavorite({ path: 'track:604' });
  assertLoaded(h);
});

test('pending and failed summary reads retain successful totals, then recover', async () => {
  const h = harness();
  await h.playlists.getState().refresh();
  const previous = h.playlists.getState();
  let reject!: (error: Error) => void;
  h.native.getFavoriteSummary = () => new Promise<PlaylistSummary>((_resolve, fail) => { reject = fail; });
  h.data.favoriteSummary = { track_count: 999, missing_track_count: 2, total_duration: 9999 };
  const pending = h.playlists.getState().refresh();
  assert.equal(h.playlists.getState().favoriteSummary, previous.favoriteSummary);
  reject(new Error('summary unavailable'));
  await assert.rejects(pending, /summary unavailable/);
  assert.equal(h.playlists.getState().favoriteSummary, previous.favoriteSummary);
  assert.equal(h.playlists.getState().playlists, previous.playlists);
  h.native.getFavoriteSummary = async () => { throw new Error('summary unavailable'); };
  await assert.rejects(h.playlists.getState().toggleFavorite({ path: 'new' }), /summary unavailable/);
  assert.equal(h.playlists.getState().favoriteSummary, previous.favoriteSummary);
  h.native.getFavoriteSummary = async () => ({ ...h.data.favoriteSummary });
  await h.playlists.getState().refresh();
  assertLoaded(h);
});

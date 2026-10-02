import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import ts from 'typescript';

const require = createRequire(import.meta.url);
const compiled = new Map<string, string>();
const tick = () => new Promise<void>((resolve) => setImmediate(resolve));
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

// Exercise the actual Zustand store and its subscriptions with controlled native
// page timing. Like playlistHydration.test, no React Native runtime is required.
async function harness() {
  const modules = new Map<string, Record<string, any>>();
  const listeners = new Map<string, () => void>();
  const calls: { name: string; args: any[] }[] = [];
  const settingListeners: ((next: any, previous: any) => void)[] = [];
  let preferences = { includeSingles: false, artistGroupingMode: 'astra' };
  const settings = {
    getState: () => ({ ...preferences, load: async () => {} }),
    subscribe: (callback: (next: any, previous: any) => void) => { settingListeners.push(callback); },
  };
  const makePage = (name: string, args: any[]) => {
    calls.push({ name, args });
    const backward = name.endsWith('Before');
    const cursorIndex = name.includes('Track') ? 2 : name.includes('Album') ? 3 : 4;
    const cursor = args[cursorIndex];
    const labels = !cursor ? ['A0'] : backward ? (cursor === 'K' ? ['A0', 'K0'] : ['L0', 'L1']) : [`${cursor}0`, `${cursor}1`];
    const items = labels.map((label, i) => ({ id: i, path: label, title: label, artist: label, identity_key: label }));
    return {
      items, nextCursor: backward ? null : 'next',
      previousCursor: backward && cursor !== 'K' ? 'K' : null,
      totalCount: 1000, catalogRevision: '1',
    };
  };
  const native: Record<string, any> = {
    initialize: async () => ({ status: 'ready', trackCount: 1000, recoveryNotice: null }),
    getSettings: async () => ({}), setSettings: async () => {},
    addListener: (name: string, fn: () => void) => { listeners.set(name, fn); },
    getRecentlyPlayed: async () => [],
    getSectionAnchors: async () => ['A', 'B', 'M', 'Z'].map((label) => ({ label, cursor: label })),
  };
  for (const kind of ['Track', 'Album', 'Artist']) {
    for (const suffix of ['', 'Before']) {
      const name = `get${kind}Page${suffix}`;
      native[name] = async (...args: any[]) => makePage(name, args);
    }
  }
  function load(file: URL): Record<string, any> {
    if (modules.has(file.href)) return modules.get(file.href)!;
    const exports: Record<string, any> = {};
    modules.set(file.href, exports);
    let source = compiled.get(file.href);
    if (!source) {
      source = ts.transpileModule(readFileSync(file, 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
      }).outputText;
      compiled.set(file.href, source);
    }
    const imports = (name: string): any => {
      if (name === 'zustand') return require(name);
      if (name.endsWith('modules/astra-library-scanner')) return { AstraLibraryData: native };
      if (name === './settingsStore') return { useSettingsStore: settings };
      if (name === './playlistStore') return { usePlaylistStore: { getState: () => ({ refresh: async () => {} }) } };
      if (name === '@/library/scanner') return { loadFolders: async () => [] };
      if (['@/library/scanService', '@/library/artistImageLookup'].includes(name)) return {};
      if (name.startsWith('@/')) return load(new URL(`../${name.slice(2)}${name.endsWith('.ts') ? '' : '.ts'}`, import.meta.url));
      if (name.startsWith('.')) return load(new URL(`${name}${name.endsWith('.ts') ? '' : '.ts'}`, file));
      throw new Error(`Unexpected dependency ${name}`);
    };
    new Function('require', 'exports', source)(imports, exports);
    return exports;
  }
  const { useLibraryStore: library } = load(new URL('./libraryStore.ts', import.meta.url)) as typeof import('./libraryStore.ts');
  await library.getState().initialize();
  calls.length = 0;
  return {
    library, native, calls, listeners,
    ready() { library.getState().sectionJumpListReady(library.getState().sectionJumpRevision); },
    settings(change: Partial<typeof preferences>) {
      const previous = preferences;
      preferences = { ...preferences, ...change };
      settingListeners.forEach((callback) => callback(preferences, previous));
    },
  };
}

for (const viewMode of ['tracks', 'albums', 'artists'] as const) {
  for (const direction of ['asc', 'desc'] as const) {
    const sorts = viewMode === 'tracks' ? ['title', 'artist'] : viewMode === 'albums' ? ['name', 'artist'] : ['name'];
    for (const sort of sorts) {
      test(`${viewMode}/${sort}/${direction}: jump, reuse, and prepend retain reachable rows above`, async () => {
        const h = await harness();
        h.library.setState({
          viewMode,
          ...(viewMode === 'tracks' ? { trackSort: sort as 'title' | 'artist', trackSortDirection: direction }
            : viewMode === 'albums' ? { albumSort: sort as 'name' | 'artist', albumSortDirection: direction }
            : { artistSort: 'name', artistSortDirection: direction }),
        });
        assert.equal(await h.library.getState().jumpToSection('M'), true);
        assert.equal(h.library.getState().jumpAnchorIndex, 2);
        assert.deepEqual(h.library.getState()[viewMode].map((item) => item.artist), ['L0', 'L1', 'M0', 'M1']);
        assert.equal(h.calls.length, 2);
        for (const call of h.calls) {
          assert.equal(call.args[0], sort);
          assert.equal(call.args[1], direction);
          assert.equal(call.args.at(-1), 200);
        }
        h.ready();
        assert.equal(await h.library.getState().jumpToSection('M'), true);
        assert.equal(h.calls.length, 2, 'cached window performs no native reads');
        h.ready();
        const previous = viewMode === 'tracks' ? 'loadPreviousTracks' : viewMode === 'albums' ? 'loadPreviousAlbums' : 'loadPreviousArtists';
        await h.library.getState()[previous]();
        assert.deepEqual(h.library.getState()[viewMode].map((item) => item.artist), ['A0', 'K0', 'L0', 'L1', 'M0', 'M1']);
        const prevCursor = viewMode === 'tracks' ? 'trackPrevCursor' : viewMode === 'albums' ? 'albumPrevCursor' : 'artistPrevCursor';
        assert.equal(h.library.getState()[prevCursor], null);
      });
    }
  }
}

test('the store coalesces letters, gates remounts, and preserves the boolean contract', async () => {
  const h = await harness();
  h.library.setState({ viewMode: 'tracks', trackSort: 'title' });
  const blocked = deferred();
  const read = h.native.getTrackPage;
  h.native.getTrackPage = async (...args: any[]) => { if (args[2] === 'A') await blocked.promise; return read(...args); };
  const a = h.library.getState().jumpToSection('A');
  await tick();
  const m = h.library.getState().jumpToSection('M');
  const z = h.library.getState().jumpToSection('Z');
  const b = h.library.getState().jumpToSection('B');
  assert.deepEqual(await Promise.all([a, m, z]), [false, false, false]);
  blocked.resolve();
  assert.equal(await b, true);
  assert.equal(h.library.getState().tracks[2].title, 'B0');
  const pending = h.library.getState().jumpToSection('Z');
  await tick();
  assert.equal(h.library.getState().tracks[2].title, 'B0');
  h.library.getState().sectionJumpListReady(h.library.getState().sectionJumpRevision - 1);
  assert.equal(h.library.getState().tracks[2].title, 'B0');
  h.ready();
  assert.equal(await pending, true);
  assert.equal(h.library.getState().tracks[2].title, 'Z0');
});

test('returning to the head cancels a read even before the first jump commits', async () => {
  const h = await harness();
  h.library.setState({ viewMode: 'tracks', trackSort: 'title' });
  const blocked = deferred();
  const read = h.native.getTrackPage;
  h.native.getTrackPage = async (...args: any[]) => { if (args[2] === 'M') await blocked.promise; return read(...args); };
  const jump = h.library.getState().jumpToSection('M');
  await tick();
  h.library.getState().cancelSectionJump();
  assert.equal(await jump, false);
  assert.equal(await h.library.getState().rewindToHead(), true);
  blocked.resolve();
  await tick();
  assert.equal(h.library.getState().jumpAnchorIndex, 0);
  assert.equal(h.library.getState().tracks[0].title, 'A0');
});

test('a cached jump commits during an obsolete native read without being overwritten', async () => {
  const h = await harness();
  h.library.setState({ viewMode: 'tracks', trackSort: 'title' });
  assert.equal(await h.library.getState().jumpToSection('M'), true);
  h.ready();
  const blocked = deferred();
  const read = h.native.getTrackPage;
  h.native.getTrackPage = async (...args: any[]) => { await blocked.promise; return read(...args); };
  const obsolete = h.library.getState().jumpToSection('Z');
  await tick();
  assert.equal(await h.library.getState().jumpToSection('M'), true);
  assert.equal(await obsolete, false);
  const revision = h.library.getState().sectionJumpRevision;
  blocked.resolve();
  await tick();
  assert.equal(h.library.getState().sectionJumpRevision, revision);
  assert.equal(h.library.getState().tracks[2].title, 'M0');
});

for (const change of ['sort', 'direction', 'view', 'layout', 'refresh', 'catalog', 'singles', 'grouping', 'collaborations', 'blur']) {
  test(`${change} invalidates a cached and pending destination`, async () => {
    const h = await harness();
    h.library.setState({ viewMode: 'albums', albumSort: 'name' });
    await h.library.getState().jumpToSection('M');
    // Still mounting M: A can be prepared but cannot yet replace it.
    const pending = h.library.getState().jumpToSection('A');
    await tick();
    const before = h.library.getState().sectionJumpRevision;
    switch (change) {
      case 'sort': h.library.getState().setAlbumSort('artist'); break;
      case 'direction': h.library.getState().setAlbumSortDirection('desc'); break;
      case 'view': h.library.getState().setViewMode('tracks'); break;
      case 'layout': h.library.getState().setAlbumLayout('list'); break;
      case 'refresh': await h.library.getState().refresh(); break;
      case 'catalog': h.listeners.get('onCatalogChanged')!(); break;
      case 'singles': h.settings({ includeSingles: true }); break;
      case 'grouping': h.settings({ artistGroupingMode: 'fileTags' }); break;
      case 'collaborations': h.library.getState().setIncludeCollabArtists(true); break;
      case 'blur': h.library.getState().cancelSectionJump(); break;
    }
    assert.equal(await pending, false);
    await tick();
    h.library.getState().sectionJumpListReady(before);
    assert.notEqual(h.library.getState().albums[2]?.artist, 'A0');
    // Restore the same context without invoking a setter, so this checks that
    // invalidation itself removed M rather than merely choosing a different key.
    h.library.setState({ viewMode: 'albums', albumSort: 'name', albumSortDirection: 'asc', includeCollabArtists: false });
    h.settings({ includeSingles: false, artistGroupingMode: 'astra' });
    await tick();
    h.ready();
    const count = h.calls.length;
    assert.equal(await h.library.getState().jumpToSection('M'), true);
    assert.equal(h.calls.length, count + 2);
  });
}

test('a failed backward read never replaces the visible window with a false head', async () => {
  const h = await harness();
  h.library.setState({ viewMode: 'tracks', trackSort: 'title' });
  const original = h.library.getState().tracks;
  h.native.getTrackPageBefore = async () => { throw new Error('native backward failure'); };
  assert.equal(await h.library.getState().jumpToSection('M'), false);
  assert.equal(h.library.getState().tracks, original);
  assert.equal(h.library.getState().jumpAnchorIndex, 0);
});

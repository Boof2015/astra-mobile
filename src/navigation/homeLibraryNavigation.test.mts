import assert from 'node:assert/strict';
import test from 'node:test';
import {
  HOME_LIBRARY_HANDOFF_PARAM,
  buildHomeLibraryResetAction,
  hasHomeLibraryHandoff,
  homeLibraryDetailRoute,
  homeLibraryTargetHref,
  withoutHomeLibraryHandoff,
  type NavigationStateLike,
} from './homeLibraryNavigation.ts';
import { libraryParentLabel, parentRoute } from './libraryDetailBack.ts';

function tabsState(libraryState?: NavigationStateLike): NavigationStateLike {
  return {
    stale: false,
    type: 'tab',
    key: 'tabs-1',
    index: 0,
    routeNames: ['index', 'library', 'eq', 'settings'],
    history: [{ type: 'route', key: 'index-1' }],
    preloadedRouteKeys: ['library-1', 'eq-1'],
    routes: [
      { key: 'index-1', name: 'index', state: { key: 'home-stack', routes: [] } },
      {
        key: 'library-1',
        name: 'library',
        params: { screen: 'album/[key]', params: { key: 'old' } },
        state: libraryState,
      },
      { key: 'eq-1', name: 'eq', params: { retained: true } },
      { key: 'settings-1', name: 'settings' },
    ],
  };
}

test('atomically selects Library and replaces stale detail history with the requested album', () => {
  const root = { key: 'library-index-1', name: 'index', params: { retained: true } };
  const oldAlbum = { key: 'album-old', name: 'album/[key]', params: { key: 'old' } };
  const oldArtist = { key: 'artist-old', name: 'artist/[name]', params: { name: 'Old' } };
  const state = tabsState({
    stale: false,
    type: 'stack',
    key: 'library-stack',
    index: 2,
    routeNames: ['index', 'album/[key]', 'artist/[name]', 'playlist/[id]'],
    preloadedRoutes: [],
    routes: [root, oldAlbum, oldArtist],
  });

  const action = buildHomeLibraryResetAction(state, { kind: 'album', key: 'new/key' });
  assert.ok(action);
  assert.equal(action.type, 'RESET');
  assert.equal(action.target, 'tabs-1');
  assert.equal(action.payload.index, 1);
  assert.deepEqual(action.payload.history, [
    { type: 'route', key: 'index-1' },
    { type: 'route', key: 'library-1' },
  ]);
  assert.deepEqual(action.payload.preloadedRouteKeys, ['eq-1']);

  const library = action.payload.routes[1];
  assert.equal(library.params, undefined);
  assert.equal(library.state?.stale, false);
  assert.equal(library.state?.type, 'stack');
  assert.equal(library.state?.key, 'library-stack');
  assert.equal(library.state?.index, 1);
  assert.equal(library.state?.routes[0], root);
  assert.match(String(library.state?.routes[1].key), /^home-library-handoff-\d+-detail$/);
  assert.equal(library.state?.routes[1].name, 'album/[key]');
  assert.deepEqual(library.state?.routes[1].params, {
    key: 'new/key',
    [HOME_LIBRARY_HANDOFF_PARAM]: true,
  });
  assert.deepEqual(library.state?.preloadedRoutes, []);
  assert.equal(libraryParentLabel(parentRoute(library.state)), 'Library');
});

test('supports artist, regular playlist, and Favorites destinations', () => {
  assert.deepEqual(homeLibraryDetailRoute({ kind: 'artist', name: 'AC/DC' }), {
    name: 'artist/[name]',
    params: { name: 'AC/DC', [HOME_LIBRARY_HANDOFF_PARAM]: true },
  });
  assert.deepEqual(homeLibraryDetailRoute({ kind: 'playlist', id: 42 }), {
    name: 'playlist/[id]',
    params: { id: '42', [HOME_LIBRARY_HANDOFF_PARAM]: true },
  });
  assert.deepEqual(homeLibraryDetailRoute({ kind: 'playlist', id: 'favorites' }), {
    name: 'playlist/[id]',
    params: { id: 'favorites', [HOME_LIBRARY_HANDOFF_PARAM]: true },
  });
  assert.equal(homeLibraryTargetHref({ kind: 'album', key: 'a/b' }), '/library/album/a%2Fb');
  assert.equal(homeLibraryTargetHref({ kind: 'artist', name: 'AC/DC' }), '/library/artist/AC%2FDC');
  assert.equal(
    homeLibraryTargetHref({ kind: 'playlist', id: 'favorites' }),
    '/library/playlist/favorites'
  );
});

test('builds a fully initialized anchored Library stack before that tab has mounted', () => {
  const state = tabsState();
  const action = buildHomeLibraryResetAction(state, { kind: 'playlist', id: 7 });
  assert.ok(action);
  const libraryState = action.payload.routes[1].state;
  assert.equal(libraryState?.stale, false);
  assert.equal(libraryState?.type, 'stack');
  assert.equal(libraryState?.index, 1);
  assert.deepEqual(libraryState?.routeNames, ['index', 'playlist/[id]']);
  assert.match(String(libraryState?.key), /^home-library-handoff-\d+-stack$/);
  assert.match(String(libraryState?.routes[0].key), /^home-library-handoff-\d+-root$/);
  assert.match(String(libraryState?.routes[1].key), /^home-library-handoff-\d+-detail$/);
  assert.deepEqual(libraryState?.routes[1].params, {
    id: '7',
    [HOME_LIBRARY_HANDOFF_PARAM]: true,
  });
});

test('preserves every unrelated tab and leaves the input state immutable', () => {
  const state = tabsState({
    key: 'library-stack',
    index: 1,
    routes: [
      { key: 'library-index', name: 'index' },
      { key: 'old-playlist', name: 'playlist/[id]', params: { id: '9' } },
    ],
  });
  const before = structuredClone(state);
  const action = buildHomeLibraryResetAction(state, { kind: 'artist', name: 'Björk' });
  assert.ok(action);
  assert.deepEqual(state, before);
  assert.equal(action.payload.routes[0], state.routes[0]);
  assert.equal(action.payload.routes[2], state.routes[2]);
  assert.equal(action.payload.routes[3], state.routes[3]);
});

test('fails safely for missing navigator identity or Library route', () => {
  assert.equal(buildHomeLibraryResetAction(undefined, { kind: 'album', key: 'a' }), null);
  assert.equal(
    buildHomeLibraryResetAction({ key: '', routes: [] }, { kind: 'album', key: 'a' }),
    null
  );
  assert.equal(
    buildHomeLibraryResetAction(
      { key: 'tabs', index: 0, routes: [{ name: 'index' }] },
      { kind: 'album', key: 'a' }
    ),
    null
  );
  assert.equal(
    buildHomeLibraryResetAction(
      { key: 'tabs', index: 0, routes: [{ key: 'home', name: 'index' }, { name: 'library' }] },
      { kind: 'album', key: 'a' }
    ),
    null
  );
});

test('the Home handoff transition marker is one-shot data', () => {
  const params = { key: 'album', [HOME_LIBRARY_HANDOFF_PARAM]: true };
  assert.equal(hasHomeLibraryHandoff(params), true);
  assert.deepEqual(withoutHomeLibraryHandoff(params), { key: 'album' });
  assert.equal(hasHomeLibraryHandoff({ [HOME_LIBRARY_HANDOFF_PARAM]: false }), false);
  assert.deepEqual(withoutHomeLibraryHandoff({ key: 'album' }), { key: 'album' });
});

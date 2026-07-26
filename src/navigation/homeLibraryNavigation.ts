/**
 * State surgery for Home -> Library detail handoffs.
 *
 * Expo Router normally focuses the retained Library tab before its nested
 * navigation is applied. If that tab was left on another detail, the stale
 * screen participates in the tab transition. Replacing the tab state and the
 * Library child state in one RESET action removes that intermediate state.
 *
 * Kept free of framework imports so the state transformation is unit-testable.
 */

export const HOME_LIBRARY_HANDOFF_PARAM = '__astra_home_library_handoff';

export type HomeLibraryTarget =
  | { kind: 'album'; key: string }
  | { kind: 'artist'; name: string }
  | { kind: 'playlist'; id: string | number };

export interface NavigationRouteLike {
  key?: string;
  name: string;
  params?: Record<string, unknown>;
  state?: NavigationStateLike;
  [key: string]: unknown;
}

export interface NavigationStateLike {
  key?: string;
  index?: number;
  routes: NavigationRouteLike[];
  [key: string]: unknown;
}

export interface HomeLibraryResetAction {
  type: 'RESET';
  target: string;
  payload: NavigationStateLike;
}

const LIBRARY_TAB_ROUTE = 'library';
const LIBRARY_ROOT_ROUTE = 'index';
let handoffSequence = 0;

function nextHandoffKeyPrefix(): string {
  handoffSequence += 1;
  return `home-library-handoff-${handoffSequence}`;
}

export function homeLibraryDetailRoute(target: HomeLibraryTarget): NavigationRouteLike {
  const handoff = { [HOME_LIBRARY_HANDOFF_PARAM]: true };

  switch (target.kind) {
    case 'album':
      return {
        name: 'album/[key]',
        params: { key: target.key, ...handoff },
      };
    case 'artist':
      return {
        name: 'artist/[name]',
        params: { name: target.name, ...handoff },
      };
    case 'playlist':
      return {
        name: 'playlist/[id]',
        params: { id: String(target.id), ...handoff },
      };
  }
}

export function homeLibraryTargetHref(target: HomeLibraryTarget): string {
  switch (target.kind) {
    case 'album':
      return `/library/album/${encodeURIComponent(target.key)}`;
    case 'artist':
      return `/library/artist/${encodeURIComponent(target.name)}`;
    case 'playlist':
      return `/library/playlist/${encodeURIComponent(String(target.id))}`;
  }
}

/**
 * Builds a single action that both selects Library and replaces its nested
 * history with [Library root, requested detail].
 *
 * The child state is fully initialized before the Library tab receives focus.
 * Supplying a stale/partial state here lets the nested navigator briefly render
 * its initial route while it rehydrates, which is the Library-list flash this
 * helper exists to prevent.
 */
export function buildHomeLibraryResetAction(
  tabsState: NavigationStateLike | undefined,
  target: HomeLibraryTarget
): HomeLibraryResetAction | null {
  if (
    !tabsState ||
    typeof tabsState.key !== 'string' ||
    tabsState.key.length === 0 ||
    !Array.isArray(tabsState.routes)
  ) {
    return null;
  }

  const libraryIndex = tabsState.routes.findIndex((route) => route.name === LIBRARY_TAB_ROUTE);
  if (libraryIndex < 0) return null;

  const libraryRoute = tabsState.routes[libraryIndex];
  const initialTabRoute = tabsState.routes[0];
  if (
    typeof libraryRoute.key !== 'string' ||
    typeof initialTabRoute?.key !== 'string'
  ) {
    return null;
  }
  const existingLibraryState =
    libraryRoute.state && Array.isArray(libraryRoute.state.routes)
      ? libraryRoute.state
      : undefined;
  const existingRoot = existingLibraryState?.routes.find(
    (route) => route.name === LIBRARY_ROOT_ROUTE
  );
  const keyPrefix = nextHandoffKeyPrefix();
  const rootRoute =
    existingRoot && typeof existingRoot.key === 'string'
      ? existingRoot
      : {
          ...(existingRoot ?? {}),
          key: `${keyPrefix}-root`,
          name: LIBRARY_ROOT_ROUTE,
        };
  const detailRoute = {
    ...homeLibraryDetailRoute(target),
    key: `${keyPrefix}-detail`,
  };
  const existingRouteNames = existingLibraryState?.routeNames;
  const routeNames =
    Array.isArray(existingRouteNames) &&
    existingRouteNames.every((name): name is string => typeof name === 'string')
      ? existingRouteNames
      : [LIBRARY_ROOT_ROUTE, detailRoute.name];

  const nextLibraryState: NavigationStateLike = {
    ...(existingLibraryState ?? {}),
    stale: false,
    type:
      typeof existingLibraryState?.type === 'string'
        ? existingLibraryState.type
        : 'stack',
    key:
      typeof existingLibraryState?.key === 'string'
        ? existingLibraryState.key
        : `${keyPrefix}-stack`,
    index: 1,
    routeNames,
    preloadedRoutes: [],
    routes: [rootRoute, detailRoute],
  };

  const nextLibraryRoute: NavigationRouteLike = {
    ...libraryRoute,
    // Clear nested-navigation command params left by earlier href navigation;
    // the explicit child state above is now the sole source of truth.
    params: undefined,
    state: nextLibraryState,
  };

  return {
    type: 'RESET',
    target: tabsState.key,
    payload: {
      ...tabsState,
      index: libraryIndex,
      // Tabs use firstRoute back behaviour, so RESET must update the history
      // invariant that an ordinary navigate-to-Library action would establish.
      history:
        libraryIndex === 0
          ? [{ type: 'route', key: libraryRoute.key }]
          : [
              { type: 'route', key: initialTabRoute.key },
              { type: 'route', key: libraryRoute.key },
            ],
      ...(Array.isArray(tabsState.preloadedRouteKeys)
        ? {
            preloadedRouteKeys: tabsState.preloadedRouteKeys.filter(
              (key) => key !== libraryRoute.key
            ),
          }
        : {}),
      routes: tabsState.routes.map((route, index) =>
        index === libraryIndex ? nextLibraryRoute : route
      ),
    },
  };
}

export function hasHomeLibraryHandoff(params: unknown): boolean {
  return (
    typeof params === 'object' &&
    params !== null &&
    HOME_LIBRARY_HANDOFF_PARAM in params &&
    (params as Record<string, unknown>)[HOME_LIBRARY_HANDOFF_PARAM] === true
  );
}

export function withoutHomeLibraryHandoff(
  params: Record<string, unknown> | undefined
): Record<string, unknown> | undefined {
  if (!params || !hasHomeLibraryHandoff(params)) return params;
  const next = { ...params };
  delete next[HOME_LIBRARY_HANDOFF_PARAM];
  return Object.keys(next).length > 0 ? next : undefined;
}

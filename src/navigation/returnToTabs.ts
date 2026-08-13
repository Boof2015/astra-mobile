import { useCallback } from 'react';
import { useNavigationContainerRef, useRouter, type Href } from 'expo-router';
import { needsTabsCollapse, type RootStateLike } from '@/navigation/tabsAnchor';

export { needsTabsCollapse, TABS_ROUTE_NAME } from '@/navigation/tabsAnchor';

/**
 * Navigate to a route that lives inside `(tabs)`.
 *
 * Use this instead of a bare `push`/`replace` anywhere the caller might not be
 * inside the tab tree — root-stack screens, and the overlays that render above
 * the navigator (now playing, quick search, action sheets). See
 * `needsTabsCollapse` for why that mints duplicate tab trees. `dismissAll()`
 * pops the root stack back to its anchor without disturbing the selected tab or
 * the library stack, and it reuses the existing route rather than minting one.
 *
 * The collapse runs first, which puts `(tabs)` back in focus and means the
 * follow-up operation diverges *inside* the tab tree. Pick it to match intent:
 *
 *  - `'navigate'` (default) for a tab root. Reuses the existing screen.
 *  - `'push'` for a library detail. Necessary because `navigate` matches on
 *    route *name*, so `/library/album/[key]` → a different key would swap params
 *    on the current screen instead of stacking — which would break walking
 *    artist → album → another artist.
 */
export function useReturnToTabs(): (href: Href, mode?: 'navigate' | 'push') => void {
  const router = useRouter();
  const rootNavigation = useNavigationContainerRef();

  return useCallback(
    (href: Href, mode: 'navigate' | 'push' = 'navigate') => {
      const rootState = rootNavigation.isReady()
        ? (rootNavigation.getRootState() as RootStateLike | undefined)
        : undefined;
      if (needsTabsCollapse(rootState) && router.canDismiss()) {
        router.dismissAll();
      }
      if (mode === 'push') router.push(href);
      else router.navigate(href);
    },
    [rootNavigation, router]
  );
}

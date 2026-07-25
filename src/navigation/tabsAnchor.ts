/** The root stack's anchor, declared by `unstable_settings` in `src/app/_layout.tsx`. */
export const TABS_ROUTE_NAME = '(tabs)';

export interface RootStateLike {
  index?: number;
  routes: { name: string }[];
}

/**
 * Whether the root stack currently has a screen sitting above the `(tabs)`
 * anchor.
 *
 * This is the condition that made back-navigation dead-end. Expo Router
 * resolves a navigation by walking down from the root and dispatching at the
 * first navigator where the target diverges from what is focused. When a root
 * sibling (`/eq/scan`, `/notification.click`, `/desktop-remote`, …) is focused
 * and the target lives inside `(tabs)`, the divergence is the ROOT stack — and
 * `StackRouter`'s PUSH/REPLACE cases create a brand new route without
 * de-duplicating by name. The root stack becomes `[(tabs)#A, (tabs)#B]`, so back
 * pops `#B` and lands on a stale second copy of the whole tab tree instead of
 * exiting. Every repeat of the flow stacks another copy.
 *
 * Collapsing to the anchor first keeps exactly one `(tabs)` alive.
 *
 * Kept free of imports so it stays unit-testable without the router.
 */
export function needsTabsCollapse(rootState: RootStateLike | undefined): boolean {
  if (!rootState) return false;
  const focused = rootState.routes[rootState.index ?? rootState.routes.length - 1];
  if (!focused) return false;
  return focused.name !== TABS_ROUTE_NAME;
}

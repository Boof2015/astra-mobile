/**
 * Which nested stack a tab-bar press has to rewind, and whether that rewind is
 * still valid by the time it runs.
 *
 * Pressing "Library" should land on the library list, not on whatever artist
 * was left open — but the rewind is deliberately done when a tab is LEFT, not
 * when it is re-entered. A native stack that pops while its scene is fading in
 * plays the dismissal animation of the screen being *removed*, in full view: the
 * artist page slides away over the library list just as the tab arrives. That
 * animation is chosen by the outgoing screen, so unlike the Home->Library
 * handoff — where `homeLibraryNavigation` can mark the screen it *adds* with a
 * param that `library/_layout.tsx` reads as `animation: 'none'` — there is
 * nothing an arrival-time state rewrite can mark to suppress it. Popping once
 * the fade has settled sidesteps it: by then the scene being popped is at
 * opacity 0 behind an opaque one.
 *
 * React Navigation's own `popToTopOnBlur` option reaches the same conclusion —
 * it dispatches exactly this action from the tab transition's completion
 * callback. It is not used here because it is dropped whenever the navigator
 * re-renders mid-transition (its effect depends on `descriptors`, which is
 * rebuilt every render, and the restarted animation reports `finished: false`),
 * and because it fires on any blur rather than only on a tab-bar press.
 *
 * Kept free of imports so the state transformation is unit-testable.
 */

export interface TabRouteLike {
  key?: string;
  name?: string;
  state?: { key?: string; index?: number };
}

export interface TabsStateLike {
  key?: string;
  index?: number;
  routes?: TabRouteLike[];
}

/**
 * The nested stack key of the tab being left, or null when it has nothing to
 * rewind (no nested navigator, never visited, or already at its root).
 *
 * Reads the genuinely focused route rather than the pressed item: `stats` is
 * focused while Home merely *looks* focused (see `statsTabState`), and only the
 * real one can be carrying a stack.
 */
export function leavingStackResetTarget(tabsState: TabsStateLike | undefined): string | null {
  const nested = tabsState?.routes?.[tabsState.index ?? 0]?.state;
  if (!nested || typeof nested.key !== 'string' || nested.key.length === 0) return null;
  return (nested.index ?? 0) > 0 ? nested.key : null;
}

/**
 * Re-checked when the rewind runs, never decided up front: a deep link — a Home
 * card, a quick-search hit, the now-playing overlay — can re-focus that tab and
 * build a fresh detail inside the delay, and truncating that would dump the user
 * back on the library list.
 */
export function shouldApplyStackReset(
  tabsState: TabsStateLike | undefined,
  stackKey: string
): boolean {
  const routes = tabsState?.routes;
  if (!Array.isArray(routes)) return false;
  const owner = routes.findIndex((route) => route.state?.key === stackKey);
  // Gone entirely (state replaced or restored), or focused again in the meantime.
  if (owner < 0) return false;
  return owner !== (tabsState?.index ?? 0);
}

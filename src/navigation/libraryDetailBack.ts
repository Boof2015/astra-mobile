/**
 * Back-affordance logic for the library detail screens (album / artist /
 * playlist).
 *
 * These screens used to force `dismissTo('/library')` on every back press and
 * swallow the hardware button, which flattened real history: opening an album
 * from an artist page and pressing back skipped the artist entirely and dropped
 * you at the library root. Back now pops one level like any stack, and the label
 * beside the chevron names whatever it will actually return to — a fixed
 * "Library" string was the reason the old behaviour had to stay unconditional.
 *
 * Kept free of imports so it stays unit-testable without the router.
 */

export interface StackRouteLike {
  name: string;
  params?: Record<string, unknown>;
}

export interface StackStateLike {
  index?: number;
  routes: StackRouteLike[];
}

/** Generic fallbacks for parents whose real title needs an async lookup. */
const LIBRARY_ROOT_LABEL = 'Library';

function focusedIndex(state: StackStateLike): number {
  return state.index ?? state.routes.length - 1;
}

/** The route beneath the focused one, or undefined at the bottom of the stack. */
export function parentRoute(state: StackStateLike | undefined): StackRouteLike | undefined {
  if (!state || state.routes.length === 0) return undefined;
  return state.routes[focusedIndex(state) - 1];
}

/**
 * Whether back can pop inside the library stack. False when the stack was
 * entered directly at a detail screen — the library layout anchors an `index`
 * route to make that rare, but a caller should still have a fallback.
 */
export function canPopWithinLibrary(state: StackStateLike | undefined): boolean {
  if (!state) return false;
  return focusedIndex(state) > 0;
}

/**
 * Label for the back chevron, naming the parent where it is free to do so.
 *
 * Artist routes carry the display name in their params, so the common
 * artist → album flow reads "‹ Radiohead". Album and playlist titles are not in
 * their params (the detail screens resolve them asynchronously by key/id), so
 * those fall back to the kind rather than triggering a lookup just for a label.
 */
export function libraryParentLabel(route: StackRouteLike | undefined): string {
  if (!route || route.name === 'index') return LIBRARY_ROOT_LABEL;
  if (route.name.startsWith('artist/[name]')) {
    const name = route.params?.name;
    if (typeof name === 'string' && name.trim() !== '') return name;
    return 'Artist';
  }
  if (route.name.startsWith('album/')) return 'Album';
  if (route.name.startsWith('playlist/')) return 'Playlist';
  return LIBRARY_ROOT_LABEL;
}

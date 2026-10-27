import { createContext, useContext } from 'react';

/**
 * Whether a navigation rail is sitting along the leading edge of the current
 * scene.
 *
 * `Screen` needs this to place horizontal safe-area insets. `BottomTabView`
 * does not narrow the safe-area context for its scenes — every screen reads the
 * full window insets whether or not the rail is already standing in the
 * cutout's way — so a scene that blindly applied `insets.left` would double-pay
 * in landscape while the rail was doing the job.
 *
 * It can't be derived from window dimensions either: `/settings/appearance` and
 * the other root-stack screens are just as landscape as the tab screens are,
 * but no rail is rendered beside them, so they must pay both insets themselves.
 * Hence a context published by the tabs layout, defaulting to false for
 * everything outside it.
 */
export const ShellRailContext = createContext(false);

/** False outside the tabs navigator, and in portrait. */
export function useShellRailPresent(): boolean {
  return useContext(ShellRailContext);
}

/**
 * Whether the current scene is one of the tab shell's own scenes.
 *
 * The bottom edge belongs to different things depending on the answer. Inside
 * `(tabs)` the shell has chrome down there — a bar that pays the system inset in
 * flow, a floating pill or card pair the scene must clear — and
 * `sceneBottomInset` is its account of what the scene owes. A root-stack screen
 * like `/settings/playback` covers all of that, so the only thing left over its
 * bottom edge is the system navigation bar. As with the rail, the window's
 * shape can't tell the two apart, so the tabs layout publishes it.
 */
export const ShellSceneContext = createContext(false);

/** True for screens rendered inside the tabs navigator. */
export function useInShellScene(): boolean {
  return useContext(ShellSceneContext);
}

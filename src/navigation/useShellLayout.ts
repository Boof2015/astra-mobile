import { PixelRatio, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { getShellLayout, type ShellLayout } from './shellLayout';
import { useInShellScene } from './shellRailContext';
import { useSettingsStore } from '@/stores/settingsStore';
import { useDelayedUnmountPresence } from '@/components/delayedPresence';
import { motion } from '@/theme/motion';

/**
 * The shell geometry for the current window.
 *
 * Screens mostly don't need this — the navigator reflows them on its own. It
 * matters for one thing: when the rail is up it already labels the current
 * destination, so a screen repeating its own name in a big heading is showing
 * the same word twice and charging a landscape window ~80dp for the privilege.
 * See `useShellShowsScreenTitle`.
 */
export function useShellLayout(): ShellLayout {
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const dockRequested = useSettingsStore((s) => s.playerDockOpen);
  // Held true until the pane has finished sliding out. The preference flips the
  // instant it's tapped, but the pane is still physically occupying its column
  // for another beat — releasing the geometry early widened the scene and
  // brought the mini-player card back *underneath* a pane that was still there,
  // costing a second reflow. Lagging it means exactly one layout change per
  // direction, and it happens when the pane is out of the way.
  const dockPresent = useDelayedUnmountPresence(dockRequested, motion.snap.duration);
  return getShellLayout(
    width,
    height,
    insets,
    PixelRatio.getFontScale(),
    dockPresent
  );
}

/**
 * False while the navigation rail is showing the destination's name itself.
 * Screens use it to drop their own title row rather than duplicate it.
 */
export function useShellShowsScreenTitle(): boolean {
  return useShellLayout().mode !== 'rail';
}

/**
 * What a scrollable surface must reserve at its bottom to clear whatever sits
 * over it outside the layout flow.
 *
 * Inside the tabs navigator that's the shell's account: the phone shape floats
 * a mini-player pill over the scene, split floats its card pair, and the rail
 * floats nothing but leaves the scene running down to the system bar.
 * Reserving the pill's footprint in the other modes is dead space at the end of
 * every list — which is what happened in landscape before this existed. Always
 * use this rather than `layout.miniPlayerFloat` directly.
 *
 * A root-stack screen covers the tab bar and everything on it, so the only
 * thing over its bottom edge is the system navigation bar. Opaque on some
 * devices — a Samsung tablet's 3-button bar cut the end off every settings page
 * before this answered for those screens too.
 */
export function useSceneBottomInset(): number {
  const inShellScene = useInShellScene();
  const shell = useShellLayout();
  const insets = useSafeAreaInsets();
  return inShellScene ? shell.sceneBottomInset : insets.bottom;
}

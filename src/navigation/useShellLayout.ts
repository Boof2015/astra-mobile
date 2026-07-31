import { PixelRatio, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { getShellLayout, type ShellLayout } from './shellLayout';

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
  return getShellLayout(width, height, insets, PixelRatio.getFontScale());
}

/**
 * False while the navigation rail is showing the destination's name itself.
 * Screens use it to drop their own title row rather than duplicate it.
 */
export function useShellShowsScreenTitle(): boolean {
  return useShellLayout().mode !== 'rail';
}

/**
 * What a scrollable surface must reserve at its bottom to clear chrome that
 * sits outside the layout flow.
 *
 * Only the phone shape floats a mini-player pill over the scene; the rail docks
 * it and the split bar seats it, and both reserve their own height. Reserving
 * the pill's footprint in those modes is dead space at the end of every list —
 * which is what happened in landscape before this existed. Always use this
 * rather than `layout.miniPlayerFloat` directly.
 */
export function useSceneBottomInset(): number {
  return useShellLayout().sceneBottomInset;
}

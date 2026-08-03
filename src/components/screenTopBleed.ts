import { createContext, useContext, useMemo } from 'react';
import { useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { topFadeBand, type TopFadeBand } from '@/components/topFadeMath';

/**
 * Whether this window lets content travel behind the status bar, and what that
 * costs whoever has to pay for it.
 *
 * Three parties need the same answer and none of them can see each other:
 * `Screen`, which stops paying its top inset; the scroll surface inside it,
 * which starts; and `TopFadeScrim`, which draws the fade that makes the
 * crossing legible. They agree by all deriving from `topFadeBand` rather than
 * by passing the answer around — a screen that decided for itself would
 * double-pay the inset the moment the window got too short to bleed.
 */

/**
 * The top safe-area inset the surrounding `Screen` did *not* pay, and which its
 * content therefore owes.
 *
 * For descendants that pin themselves to the top of a screen without knowing
 * which screen they are on — `PullSearchGesture`'s chip is the live case, and
 * it is shared between a screen that bleeds (Home) and one that doesn't
 * (Library). Zero by default, so everything that has not opted in is untouched.
 */
export const ScreenTopBleedContext = createContext(0);

/** Zero on a screen whose container pays its own top inset. */
export function useScreenTopBleed(): number {
  return useContext(ScreenTopBleedContext);
}

/**
 * The fade this window gets, or null if it should not bleed at all.
 *
 * Asked *before* the inset is dropped, because bleeding without a fade is the
 * bare clip the whole feature exists to remove.
 */
export function useTopFadeBand(): TopFadeBand | null {
  const insetTop = useSafeAreaInsets().top;
  const windowHeight = useWindowDimensions().height;
  return useMemo(() => topFadeBand(insetTop, windowHeight), [insetTop, windowHeight]);
}

/**
 * What a bleeding screen's scroll surface must re-pay as `paddingTop`.
 *
 * Zero when the window declined to bleed, which is what keeps a screen that
 * passes `bleedTop` correct in landscape: `Screen` goes on paying the inset and
 * the content must not pay it again.
 */
export function useTopBleedInset(): number {
  const insetTop = useSafeAreaInsets().top;
  return useTopFadeBand() ? insetTop : 0;
}

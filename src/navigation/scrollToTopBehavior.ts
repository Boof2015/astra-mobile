/**
 * Whether a programmatic scroll back to the top should animate.
 *
 * A smooth scroll is the nicer cue that the list moved rather than reloaded, but
 * flying it back from row 5000 recycles every row in between and shows a smear
 * of blank cells. Close to the top there is nothing to recycle, so animate; far
 * from it, jump.
 */

/** Screens' worth of travel still worth animating. */
export const ANIMATED_SCROLL_TOP_SCREENS = 3;

export function shouldAnimateScrollToTop(offsetY: number, viewportHeight: number): boolean {
  // No measurement yet (0 until first layout) — a jump is the safe assumption,
  // since the distance is unknown rather than known to be small.
  if (!(viewportHeight > 0)) return false;
  return offsetY <= viewportHeight * ANIMATED_SCROLL_TOP_SCREENS;
}

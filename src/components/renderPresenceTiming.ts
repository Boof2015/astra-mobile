import { TAB_TRANSITION_SETTLE_MS } from '../navigation/tabTransition.ts';

/** Slightly longer than the overlay's 200 ms direct-close animation. */
export const NOW_PLAYING_CLOSE_UNMOUNT_MS = 220;

/**
 * Backstop for committing the now-playing close. The exit spring normally
 * commits it from its own completion callback, but a cancelled spring never
 * reports completion — and before this existed, that stranded the player's
 * phase and made it impossible to reopen. Long enough that the animation
 * ordinarily wins the race.
 */
export const NOW_PLAYING_CLOSE_COMMIT_MS = 450;

/** Matches the overlay's 240 ms enter animation, then settles `opening` → `open`. */
export const NOW_PLAYING_OPEN_SETTLE_MS = 260;

/** Keep the EQ surface through the native tab spring's settling window. */
export const EQ_GRAPH_UNMOUNT_DELAY_MS = TAB_TRANSITION_SETTLE_MS + 30;

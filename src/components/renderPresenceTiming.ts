import { TAB_TRANSITION_SETTLE_MS } from '../navigation/tabTransition.ts';

/** Slightly longer than the overlay's 200 ms direct-close animation. */
export const NOW_PLAYING_CLOSE_UNMOUNT_MS = 220;

/** Keep the EQ surface through the native tab spring's settling window. */
export const EQ_GRAPH_UNMOUNT_DELAY_MS = TAB_TRANSITION_SETTLE_MS + 30;

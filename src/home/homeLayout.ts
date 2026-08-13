import { spacing } from '../theme/spacing.ts';

/**
 * Home's response to a wide scene.
 *
 * Home is a stack of sections that were all proportioned against a phone in
 * portrait. Handed a tablet they don't break, they just stop meaning anything:
 * a `TrackRow` spanning 1200dp puts the title at the far left and the duration
 * at the far right with nothing between them, and the spotlight card becomes an
 * 88dp cover marooned in a very long box.
 *
 * The fix is not to invent tablet sections. It is to notice that the sections
 * come in pairs of similar weight — two cards, then two row lists — and to seat
 * each pair side by side once the scene can give both halves a phone-shaped
 * column. Every section keeps its own component, header and behaviour; only the
 * column it lives in changes.
 *
 * Keyed on **content width, not the window**: the player dock claims up to
 * 520dp of the scene, so a tablet drops back to one column the moment the dock
 * opens. Callers measure and pass what they actually got.
 */
export interface HomeLayout {
  /** Sections seat two-up rather than stacking full width. */
  paired: boolean;
  /** Square cover on the random spotlight card. */
  spotlightCoverSize: number;
  /** Square cover on each Recently Added rail tile. */
  railCoverSize: number;
  /** Rows to show under Recently Played. */
  recentTrackCount: number;
}

/**
 * Narrowest a column may be and still read as a home section rather than a
 * squeezed one.
 *
 * A phone in portrait gives these sections 380dp, so 320 is the same shape with
 * less air — a `TrackRow` loses nothing at that width. It is set low
 * deliberately: a phone in landscape has ~695dp of content and only ~411dp of
 * height, which is the window that needs two-up *most*, and a threshold tuned
 * for tablets would miss it. As with the navigation rail, the trigger is a
 * measurement, not a device class.
 */
const PAIR_MIN_COLUMN_WIDTH = 320;

/** Gutter between the two columns. Exported so the row and the fit agree. */
export const HOME_COLUMN_GAP = spacing.lg;

const PAIR_MIN_CONTENT_WIDTH = PAIR_MIN_COLUMN_WIDTH * 2 + HOME_COLUMN_GAP;

/**
 * The spotlight cover grows when paired so the card earns the height its
 * neighbour sets — left at 88 it is a short wide card beside a tall one, and
 * the row reads as two unrelated things rather than one band.
 *
 * Two declared tiers rather than a ratio of the column: the meta beside the
 * cover has to seat three action buttons (124dp) plus a readable title, so a
 * cover that scales freely eats the title long before it runs out of column.
 */
const SPOTLIGHT_COVER_WIDTH = 88;
const SPOTLIGHT_COVER_WIDTH_PAIRED = 112;
const SPOTLIGHT_COVER_WIDTH_WIDE = 144;
/** Column width at which the wide cover still leaves the meta room to breathe. */
const SPOTLIGHT_WIDE_COLUMN_WIDTH = 420;

/**
 * Rail tiles grow too, for a different reason: the rail is the one section that
 * keeps the full width, and 112dp tiles across 1200dp read as a filmstrip of
 * thumbnails rather than a shelf of albums.
 */
const RAIL_COVER_WIDTH = 112;
const RAIL_COVER_WIDTH_PAIRED = 140;

/**
 * Recently Played sits beside Favorites & Playlists, which can show five rows.
 * Three against five leaves the band visibly lopsided, and the extra rows are
 * free — they come from a list already in memory.
 */
const RECENT_TRACK_COUNT = 3;
const RECENT_TRACK_COUNT_PAIRED = 5;

/** Width one column gets at `contentWidth`. Full width when unpaired. */
export function homeColumnWidth(contentWidth: number): number {
  if (!isPaired(contentWidth)) return contentWidth;
  return (contentWidth - HOME_COLUMN_GAP) / 2;
}

function isPaired(contentWidth: number): boolean {
  // Before first layout there is nothing to measure. Fall back to the phone
  // shape so the first frame is never the wide one collapsing.
  return Number.isFinite(contentWidth) && contentWidth >= PAIR_MIN_CONTENT_WIDTH;
}

export function getHomeLayout(contentWidth: number): HomeLayout {
  const paired = isPaired(contentWidth);
  const spotlightCoverSize = !paired
    ? SPOTLIGHT_COVER_WIDTH
    : homeColumnWidth(contentWidth) >= SPOTLIGHT_WIDE_COLUMN_WIDTH
      ? SPOTLIGHT_COVER_WIDTH_WIDE
      : SPOTLIGHT_COVER_WIDTH_PAIRED;
  return {
    paired,
    spotlightCoverSize,
    railCoverSize: paired ? RAIL_COVER_WIDTH_PAIRED : RAIL_COVER_WIDTH,
    recentTrackCount: paired ? RECENT_TRACK_COUNT_PAIRED : RECENT_TRACK_COUNT,
  };
}

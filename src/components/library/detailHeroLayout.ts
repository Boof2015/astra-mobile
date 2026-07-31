import { spacing } from '../../theme/spacing.ts';

/**
 * Geometry for the collapsing detail hero (artist / album / playlist).
 *
 * Portrait stacks a centred column: artwork, then title, meta and buttons below
 * it. That column is ~448dp tall, which is more than a landscape window *has* —
 * and because the header is an absolute overlay whose height also becomes the
 * list's top padding, an oversized hero pushes row 1 off the bottom and leaves
 * the hero block covering the entire viewport, swallowing the drag that would
 * scroll it away. The page looked broken and could not be scrolled at all.
 *
 * Landscape therefore turns the hero on its side: artwork on the left, title /
 * meta / buttons beside it, so the hero costs height proportional to its
 * *content* rather than to the artwork's width.
 */

const ART_SIZE = 210;
export const DETAIL_ART_COLLAPSED = 34;
export const DETAIL_BAR_H = 48;
const ART_TOP = 44;
/** Gap between the artwork and the block that follows it. */
const ART_TO_BLOCK_GAP = 8;
/** Gap below the buttons to the header's bottom edge (where row 1 sits at rest). */
const BLOCK_BOTTOM_PAD = 20;

const WIDE_ART_MAX = 150;
const WIDE_ART_MIN = 96;
/** Share of the window's usable height the landscape artwork may claim. */
const WIDE_ART_HEIGHT_RATIO = 0.36;
const WIDE_ART_LEFT = spacing.xl;
const WIDE_COLUMN_GAP = spacing.xl;

/**
 * Ceiling on the whole expanded header as a share of the window.
 *
 * A hero taller than its window is not merely ugly: the list's top padding is
 * this same number, so nothing is reachable and no drag lands on the scroller.
 * Whatever else changes, the list keeps a grabbable strip.
 */
const MAX_HEADER_SHARE = 0.72;

export interface DetailHeroLayout {
  wide: boolean;
  artSize: number;
  artTop: number;
  /** Left edge of the expanded artwork. */
  artLeft: number;
  /** Horizontal centre of the expanded artwork, for the collapse tween. */
  artCenterX: number;
  /** Top of the title/meta/buttons block. */
  blockTop: number;
  blockLeft: number;
  blockRight: number;
  blockAlign: 'center' | 'flex-start';
  textAlign: 'center' | 'left';
  /** Expanded header height below the top inset, before the block is measured. */
  fallbackExpandedHeight: number;
  /** Largest header this window tolerates while leaving the list reachable. */
  maxExpandedHeight: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function getDetailHeroLayout(
  windowWidth: number,
  windowHeight: number,
  topInset: number
): DetailHeroLayout {
  const usableHeight = Math.max(0, windowHeight - topInset);
  const maxExpandedHeight = Math.max(
    DETAIL_BAR_H,
    Math.round(windowHeight * MAX_HEADER_SHARE) - topInset
  );
  const wide = windowWidth > windowHeight;

  if (!wide) {
    const blockTop = ART_TOP + ART_SIZE + ART_TO_BLOCK_GAP;
    return {
      wide: false,
      artSize: ART_SIZE,
      artTop: ART_TOP,
      artLeft: Math.round((windowWidth - ART_SIZE) / 2),
      artCenterX: Math.round(windowWidth / 2),
      blockTop,
      blockLeft: spacing.lg,
      blockRight: spacing.lg,
      blockAlign: 'center',
      textAlign: 'center',
      fallbackExpandedHeight: blockTop + 154 + BLOCK_BOTTOM_PAD,
      maxExpandedHeight,
    };
  }

  const artSize = Math.round(
    clamp(usableHeight * WIDE_ART_HEIGHT_RATIO, WIDE_ART_MIN, WIDE_ART_MAX)
  );
  return {
    wide: true,
    artSize,
    artTop: ART_TOP,
    artLeft: WIDE_ART_LEFT,
    artCenterX: WIDE_ART_LEFT + Math.round(artSize / 2),
    // Beside the artwork, not beneath it — the whole point of the wide hero.
    blockTop: ART_TOP,
    blockLeft: WIDE_ART_LEFT + artSize + WIDE_COLUMN_GAP,
    blockRight: spacing.lg,
    blockAlign: 'flex-start',
    textAlign: 'left',
    fallbackExpandedHeight: ART_TOP + artSize + BLOCK_BOTTOM_PAD,
    maxExpandedHeight,
  };
}

/**
 * Expanded header height once the block has been measured.
 *
 * In landscape the artwork and the block sit side by side, so the taller of the
 * two sets the height; in portrait the block simply follows the artwork.
 */
export function getDetailExpandedHeight(
  layout: DetailHeroLayout,
  measuredBlockHeight: number
): number {
  const blockBottom = layout.blockTop + measuredBlockHeight;
  const artBottom = layout.artTop + layout.artSize;
  const natural =
    (layout.wide ? Math.max(blockBottom, artBottom) : blockBottom) + BLOCK_BOTTOM_PAD;
  return Math.min(natural, layout.maxExpandedHeight);
}

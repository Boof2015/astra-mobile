/**
 * Where a sliding selection mark belongs, given what the items actually
 * measured.
 *
 * This exists because the previous mark was positioned by index arithmetic —
 * `Math.max(0, findIndex(focused))` slots wide, each `containerWidth / count`
 * across. Both halves of that are assumptions: the `Math.max` turns "nothing is
 * selected" into "the first thing is selected", and the even division assumes
 * every item is the same size and the container has no padding. The nav bar has
 * three shapes now — a phone's equal-flex row, a rail's fixed-height column, and
 * a split card whose item widths change when the player dock opens — so the
 * division is wrong in two of them, and the fallback slot was wrong in all
 * three. That combination is what "highlight the wrong thing" was.
 *
 * A mark placed from the measured rect of the item it points at cannot disagree
 * with that item, whatever shape the shell is in. When there is nothing to point
 * at this returns null, and the caller hides the mark rather than parking it
 * somewhere.
 */

/** One item's box along the mark's travel axis: x/width, or y/height in a rail. */
export interface ItemRect {
  offset: number;
  extent: number;
}

export type MarkPlacement = ItemRect;

/**
 * Whether a layout pass said anything worth recording.
 *
 * A container reports its children at zero extent before it has been sized —
 * on the first pass after a cold start, and occasionally again mid-flight. That
 * is not a position, it is the absence of one. Believing it collapses the mark's
 * box, and because the bar is *centred* in that box a collapse slides the
 * visible mark half a tab to the left and then back as the real width lands.
 * That flash was the whole symptom.
 */
export function isMeasured(rect: ItemRect): boolean {
  return rect.extent > 0;
}

/**
 * The selected item's rect, or null when the mark should not be shown at all.
 *
 * Null covers "nothing is selected" and "selected, but it hasn't honestly
 * reported a layout yet" — an unmeasured item has no position, and guessing one
 * is the bug this module replaces.
 */
export function resolveMark(
  rects: ReadonlyMap<string, ItemRect>,
  activeKey: string | null
): MarkPlacement | null {
  if (activeKey === null) return null;
  const rect = rects.get(activeKey);
  if (!rect || !isMeasured(rect)) return null;
  return rect;
}

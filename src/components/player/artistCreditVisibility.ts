const WIDTH_TOLERANCE = 1;

/**
 * Pick the largest leading run of artist credits that leaves room for the
 * corresponding "+N more" action. Returning artistCount means the complete
 * credit fits (or measurement has not settled yet), so no overflow action is
 * needed.
 */
export function resolveVisibleArtistCreditCount({
  artistCount,
  availableWidth,
  prefixWidths,
  moreLabelWidths,
}: {
  artistCount: number;
  availableWidth: number;
  /** Natural width of the first N credits, keyed by N. */
  prefixWidths: Readonly<Record<number, number | undefined>>;
  /** Natural width of "+N more", keyed by N. */
  moreLabelWidths: Readonly<Record<number, number | undefined>>;
}): number {
  if (artistCount <= 1) return Math.max(0, artistCount);

  const fullWidth = prefixWidths[artistCount];
  if (availableWidth <= 0 || !fullWidth) return artistCount;
  if (fullWidth <= availableWidth + WIDTH_TOLERANCE) return artistCount;

  for (let visibleCount = artistCount - 1; visibleCount >= 1; visibleCount -= 1) {
    const prefixWidth = prefixWidths[visibleCount];
    const hiddenCount = artistCount - visibleCount;
    const moreLabelWidth = moreLabelWidths[hiddenCount];
    if (
      prefixWidth !== undefined &&
      moreLabelWidth !== undefined &&
      prefixWidth + moreLabelWidth <= availableWidth + WIDTH_TOLERANCE
    ) {
      return visibleCount;
    }
  }

  // Keep one artist as context. The rendered prefix can ellipsize independently
  // while the overflow action remains fully visible.
  return 1;
}

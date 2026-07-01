/** Minimum width for two-pane layouts — below this, panes get too cramped to use. */
export const WIDE_MIN_WIDTH = 600;

/**
 * True when a window should use a two-pane / wide layout: wide enough for two
 * useful panes and wider than it is tall (single columns overflow short windows).
 * Pass inset-adjusted dimensions (window minus safe areas).
 */
export function isWideWindow(availableWidth: number, availableHeight: number): boolean {
  return availableWidth >= WIDE_MIN_WIDTH && availableWidth > availableHeight;
}

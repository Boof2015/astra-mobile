/**
 * Whether "back to the top" has to rebuild the library window rather than just
 * scroll it.
 *
 * `jumpToSection` loads the jumped-to letter's page *plus* the page above it, so
 * after an A-Z rail jump rendered index 0 is a row somewhere in the middle of
 * the catalog and scrolling to offset 0 would stop at the top of the window, not
 * the top of the library. The per-list `*PrevCursor` is non-null exactly when
 * rows exist above the loaded window, which makes it the test for "offset 0 is
 * a lie".
 *
 * Kept free of store imports so the rule stays unit-testable.
 */

export interface LibraryWindowCursors {
  trackPrevCursor: string | null;
  albumPrevCursor: string | null;
  artistPrevCursor: string | null;
}

export function needsWindowRewind(viewMode: string, cursors: LibraryWindowCursors): boolean {
  switch (viewMode) {
    case 'tracks':
      return cursors.trackPrevCursor !== null;
    case 'albums':
      return cursors.albumPrevCursor !== null;
    case 'artists':
      return cursors.artistPrevCursor !== null;
    // Playlists and folders are rendered whole, never cursor-paged.
    default:
      return false;
  }
}

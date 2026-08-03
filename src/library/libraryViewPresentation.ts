import type { LibraryViewMode } from './libraryViewMode.ts';

export const LIBRARY_CONTEXT_BAR_HEIGHT = 52;
export const LIBRARY_CONTEXT_TOP_GAP = 8;
export const LIBRARY_CONTEXT_FADE_TAIL = 48;

/**
 * FlashList treats `initialScrollIndex={0}` as an explicit scroll request. That
 * request runs after mount and consumes the list's top padding, which makes a
 * freshly selected Library surface report a collapsed-header offset. At the
 * logical head there must be no initial-scroll prop at all.
 */
export function flashListInitialAnchor(index: number): number | undefined {
  return Number.isInteger(index) && index > 0 ? index : undefined;
}

export function libraryContextActionCount(mode: LibraryViewMode): number {
  if (mode === 'albums' || mode === 'artists') return 3;
  if (mode === 'tracks' || mode === 'playlists') return 2;
  return 1;
}

/** Phone chrome clears the player only while the player actually exists. */
export function libraryContextBottomClearance(
  sceneBottomInset: number,
  miniPlayerVisible: boolean,
  restingGap = 8
): number {
  return miniPlayerVisible ? Math.max(0, sceneBottomInset) : restingGap;
}

/** The complete bottom stack covered by the floating Library command bar. */
export function libraryContextOverlayHeight(bottomClearance: number): number {
  return Math.max(0, bottomClearance) +
    LIBRARY_CONTEXT_TOP_GAP +
    LIBRARY_CONTEXT_BAR_HEIGHT;
}

/**
 * Starts the shared bottom fade above the command bar instead of at its edge,
 * so rows disappear gradually behind both pieces of floating chrome.
 */
export function libraryContextScrimHeight(bottomClearance: number): number {
  return libraryContextOverlayHeight(bottomClearance) + LIBRARY_CONTEXT_FADE_TAIL;
}

/**
 * The section control owns the space left after fixed action targets. Keeping
 * this arithmetic pure lets narrow-phone tests prove the label never steals a
 * touch target from the actions beside it.
 */
export function libraryContextSectionWidth(
  availableWidth: number,
  actionCount: number,
  horizontalInset = 12,
  actionSize = 44
): number {
  return Math.max(0, availableWidth - horizontalInset * 2 - actionCount * actionSize);
}

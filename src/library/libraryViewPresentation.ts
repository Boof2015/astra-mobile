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

/**
 * Head-mounted catalogs do not need FlashList's default scroll anchor. Leaving
 * it enabled lets the native list preserve item 0 by consuming the collapsing
 * header's content padding. A positive A-Z window does need it while earlier
 * pages are prepended.
 */
export function flashListMaintainsVisiblePosition(index: number): boolean {
  return flashListInitialAnchor(index) !== undefined;
}

const LIBRARY_DOCK_ACTION_SIZE = 44;
const LIBRARY_DOCK_HORIZONTAL_INSET = 12;
const LIBRARY_DOCK_SECTION_COUNT = 5;
const LIBRARY_DOCK_LABEL_MIN_WIDTH = 248;
const LIBRARY_DOCK_LABEL_MAX_FONT_SCALE = 1.05;

/** Space shared by the five direct section targets after search/options. */
export function libraryDockSectionWidth(
  availableWidth: number,
  horizontalInset = LIBRARY_DOCK_HORIZONTAL_INSET,
  actionSize = LIBRARY_DOCK_ACTION_SIZE
): number {
  // Search and the contextual slot are always reserved. Folders leaves the
  // latter visually empty instead of letting every section target jump wider.
  return Math.max(0, availableWidth - horizontalInset * 2 - actionSize * 2);
}

/**
 * A labelled active target needs two shares while its four neighbours keep one
 * each. Narrow screens and enlarged text use equal icon-only targets instead.
 */
export function libraryDockShowsActiveLabel(
  availableWidth: number,
  fontScale: number
): boolean {
  return libraryDockSectionWidth(availableWidth) >=
      LIBRARY_DOCK_LABEL_MIN_WIDTH &&
    fontScale <= LIBRARY_DOCK_LABEL_MAX_FONT_SCALE;
}

export function libraryDockTargetWidths(
  sectionWidth: number,
  showActiveLabel: boolean
): { active: number; inactive: number } {
  const shares = showActiveLabel
    ? LIBRARY_DOCK_SECTION_COUNT + 1
    : LIBRARY_DOCK_SECTION_COUNT;
  const inactive = Math.max(0, sectionWidth) / shares;
  return {
    active: showActiveLabel ? inactive * 2 : inactive,
    inactive,
  };
}

export type LibraryDockSwipeDirection = -1 | 1;

export function libraryDockSwipeDistance(width: number): number {
  'worklet';
  return Math.max(32, Math.min(56, width * 0.16));
}

/** Resolve a deliberate horizontal dock gesture into an adjacent-section step. */
export function resolveLibraryDockSwipe({
  translationX,
  velocityX,
  width,
}: {
  translationX: number;
  velocityX: number;
  width: number;
}): LibraryDockSwipeDirection | null {
  'worklet';
  const distanceThreshold = libraryDockSwipeDistance(width);
  const passedDistance = Math.abs(translationX) >= distanceThreshold;
  const passedFling = Math.abs(translationX) >= 12 && Math.abs(velocityX) >= 500;
  if (!passedDistance && !passedFling) return null;
  return translationX < 0 ? 1 : -1;
}

/** Phone chrome clears the player only while the player actually exists. */
export function libraryContextBottomClearance(
  sceneBottomInset: number,
  miniPlayerVisible: boolean,
  restingGap = 8
): number {
  return miniPlayerVisible ? Math.max(0, sceneBottomInset) : restingGap;
}

/**
 * The phone Library bar is navigation, so transient overlays never participate
 * in its lifetime. Sheets paint above it instead of asking it to unmount.
 */
export function libraryContextBarVisible(
  phoneContextBar: boolean,
  showLibraryStatus: boolean
): boolean {
  return phoneContextBar && !showLibraryStatus;
}

/** The complete bottom stack covered by the floating Library command bar. */
export function libraryContextOverlayHeight(bottomClearance: number): number {
  return Math.max(0, bottomClearance) +
    LIBRARY_CONTEXT_TOP_GAP +
    LIBRARY_CONTEXT_BAR_HEIGHT;
}

/** Keep the A-Z gesture surface above floating chrome and the bottom safe area. */
export function libraryRailBottomClearance(
  phoneContextBar: boolean,
  contextOverlayHeight: number,
  sceneBottomClearance = 0,
): number {
  return Math.max(0, phoneContextBar ? contextOverlayHeight : sceneBottomClearance);
}

/**
 * Starts the shared bottom fade above the command bar instead of at its edge,
 * so rows disappear gradually behind both pieces of floating chrome.
 */
export function libraryContextScrimHeight(bottomClearance: number): number {
  return libraryContextOverlayHeight(bottomClearance) + LIBRARY_CONTEXT_FADE_TAIL;
}

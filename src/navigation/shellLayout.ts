import { MAX_FONT_SCALE, variantLineHeight } from '../theme/typography.ts';

/**
 * App shell navigation geometry.
 *
 * Portrait keeps the bottom tab bar with the mini-player pill above it. A
 * landscape window is only ~411dp tall, and that chrome costs it 152dp — so
 * landscape moves navigation to a vertical rail down the leading edge with the
 * mini player docked at its foot, handing the whole height back to the scene.
 *
 * The rail is narrow, so the binding constraint is its own *height*: four nav
 * items plus a mini player have to fit between the safe areas. This module owns
 * that arithmetic with declared sizes rather than estimates, the same way
 * `components/player/nowPlayingLayout.ts` does, and the mini-player block gives
 * ground before anything is allowed to overflow.
 */

export type ShellNavigationMode = 'tabs' | 'rail';

/** Rail content width, before the leading safe-area inset is added on. */
const RAIL_CONTENT_WIDTH = 104;
/** Exported so the rail's padding and `railContentWidth` cannot drift apart. */
export const RAIL_SIDE_PADDING = 8;
/** Icon over label, with a touch target that clears the 48dp minimum. */
const NAV_ITEM_HEIGHT = 52;
/** Floor before a nav item stops being a comfortable target. */
const NAV_ITEM_MIN_HEIGHT = 44;
const NAV_ICON_SIZE = 22;
const NAV_LABEL_GAP = 2;
/** Destinations in the rail: Home, Library, EQ, Settings. */
const NAV_ITEM_COUNT = 4;

/**
 * Narrowest window that can afford a rail *and* still have a usable content
 * column beside it (480 − 104 = 376dp, about a portrait phone's worth).
 *
 * Deliberately NOT `isWideWindow`: that helper's 600dp floor exists because the
 * now-playing screen needs two useful *panes*, which is a much bigger ask than
 * one 104dp rail. Reusing it would leave a 568x320 landscape phone — the window
 * that needs the height back most — stuck with bottom tabs.
 */
const RAIL_MIN_WINDOW_WIDTH = 480;

const RAIL_MINI_ART_MAX = 72;
const RAIL_MINI_ART_MIN = 40;
const RAIL_MINI_CONTROL_SIZE = 36;
const RAIL_MINI_PROGRESS_HEIGHT = 2;
const RAIL_MINI_GAP = 6;
/** Breathing room between the last nav item and the mini player. Exported so
 * the renderer subtracts exactly what `blockHeight` reserved. */
export const RAIL_MINI_TOP_MARGIN = 16;

export interface ShellInsets {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

export interface RailMiniPlayerLayout {
  /** 0 when the rail is too short to show artwork at all. */
  artSize: number;
  /** 0 when the title line had to be dropped. */
  titleLineHeight: number;
  progressHeight: number;
  controlSize: number;
  gap: number;
  /** Total height the block occupies, margin included. */
  blockHeight: number;
}

export interface ShellLayout {
  mode: ShellNavigationMode;
  /** Full rail width including the leading safe-area inset. */
  railWidth: number;
  /** Usable width inside the rail's own padding. */
  railContentWidth: number;
  /** Height available to rail contents, between the safe areas. */
  railHeight: number;
  navItemHeight: number;
  navIconSize: number;
  navLabelGap: number;
  miniPlayer: RailMiniPlayerLayout;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * The smallest mini-player still worth calling one: artwork at its floor, a
 * title line, progress and controls. Nav items shrink toward their own floor to
 * protect this much before anything here is dropped.
 */
function miniPlayerIdealBlock(scale: number): number {
  return (
    RAIL_MINI_ART_MIN +
    Math.ceil(variantLineHeight.label * scale) +
    RAIL_MINI_PROGRESS_HEIGHT +
    RAIL_MINI_CONTROL_SIZE +
    RAIL_MINI_GAP * 3 +
    RAIL_MINI_TOP_MARGIN
  );
}

/**
 * Shell geometry for a window. See `RAIL_MIN_WINDOW_WIDTH` for why the rail's
 * threshold is its own rather than the player's `isWideWindow`.
 */
export function getShellLayout(
  width: number,
  height: number,
  insets: ShellInsets,
  fontScale = 1
): ShellLayout {
  const scale = clamp(fontScale, 1, MAX_FONT_SCALE);
  const railHeight = Math.max(0, height - insets.top - insets.bottom);
  const preferredNavItem = Math.max(
    NAV_ITEM_HEIGHT,
    NAV_ICON_SIZE + NAV_LABEL_GAP + Math.ceil(variantLineHeight.caption * scale) + 12
  );
  // Nav items give up their padding before the mini player gives up its
  // artwork. Holding them at the preferred height cost an S22 in landscape its
  // artwork *and* its title by 2dp, which is a miserable trade for 8dp of
  // padding spread over four buttons.
  const navShare = Math.floor(
    (railHeight - miniPlayerIdealBlock(scale)) / NAV_ITEM_COUNT
  );
  // The floor tracks the label rather than being a flat constant: what an item
  // may concede is its padding, never the room its own text needs. A fixed 44
  // let a larger font setting shrink the very buttons whose labels had grown.
  const navItemFloor = Math.max(
    NAV_ITEM_MIN_HEIGHT,
    NAV_ICON_SIZE + NAV_LABEL_GAP + Math.ceil(variantLineHeight.caption * scale) + 4
  );
  // Never taller than an equal share of the rail either: the items have to fit
  // by construction, or `railContentsFit` would be reporting a promise this
  // module doesn't keep.
  const navItemHeight = Math.min(
    clamp(navShare, navItemFloor, preferredNavItem),
    Math.floor(railHeight / NAV_ITEM_COUNT)
  );
  const navBlock = navItemHeight * NAV_ITEM_COUNT;

  // Landscape, wide enough for a rail plus a real content column, and tall
  // enough to host the rail's own items at a pressable size. A window that
  // fails the last test is worse off with a rail than without one.
  const mode: ShellNavigationMode =
    width > height &&
    width >= RAIL_MIN_WINDOW_WIDTH &&
    navItemHeight >= NAV_ITEM_MIN_HEIGHT
      ? 'rail'
      : 'tabs';

  // Whatever the nav items don't need is the mini player's, and it shrinks to
  // fit rather than pushing anything out of the rail.
  const miniBudget = Math.max(0, railHeight - navBlock - RAIL_MINI_TOP_MARGIN);
  const titleLineHeight = Math.ceil(variantLineHeight.label * scale);
  const railContentWidth = Math.max(0, RAIL_CONTENT_WIDTH - RAIL_SIDE_PADDING * 2);

  const miniPlayer = fitRailMiniPlayer(miniBudget, railContentWidth, titleLineHeight);

  return {
    mode,
    railWidth: RAIL_CONTENT_WIDTH + insets.left,
    railContentWidth,
    railHeight,
    navItemHeight,
    navIconSize: NAV_ICON_SIZE,
    navLabelGap: NAV_LABEL_GAP,
    miniPlayer,
  };
}

/**
 * Fit artwork + title + progress + controls into `budget`.
 *
 * Order of sacrifice: the artwork shrinks first (it is the only elastic part),
 * then the title line goes, then the artwork goes entirely. The controls are
 * the last thing standing — a mini player you cannot press is not worth
 * rendering.
 */
function fitRailMiniPlayer(
  budget: number,
  contentWidth: number,
  titleLineHeight: number
): RailMiniPlayerLayout {
  const controls = RAIL_MINI_CONTROL_SIZE;
  const empty: RailMiniPlayerLayout = {
    artSize: 0,
    titleLineHeight: 0,
    progressHeight: 0,
    controlSize: 0,
    gap: RAIL_MINI_GAP,
    blockHeight: 0,
  };
  if (budget < controls) return empty;

  const build = (artSize: number, withTitle: boolean): RailMiniPlayerLayout => {
    const title = withTitle ? titleLineHeight : 0;
    const progress = artSize > 0 ? RAIL_MINI_PROGRESS_HEIGHT : 0;
    const parts = [artSize, title, progress, controls].filter((part) => part > 0);
    const height =
      parts.reduce((total, part) => total + part, 0) +
      RAIL_MINI_GAP * Math.max(0, parts.length - 1);
    return {
      artSize,
      titleLineHeight: title,
      progressHeight: progress,
      controlSize: controls,
      gap: RAIL_MINI_GAP,
      blockHeight: height + RAIL_MINI_TOP_MARGIN,
    };
  };

  // Artwork is square, so it can never exceed the rail's width either.
  const artCap = Math.min(RAIL_MINI_ART_MAX, contentWidth);
  const artBudget =
    budget - titleLineHeight - RAIL_MINI_PROGRESS_HEIGHT - controls - RAIL_MINI_GAP * 3;
  if (artBudget >= RAIL_MINI_ART_MIN) {
    return build(Math.round(clamp(artBudget, RAIL_MINI_ART_MIN, artCap)), true);
  }

  // No room for both artwork and a title — drop the title and retry.
  const artOnlyBudget = budget - RAIL_MINI_PROGRESS_HEIGHT - controls - RAIL_MINI_GAP * 2;
  if (artOnlyBudget >= RAIL_MINI_ART_MIN) {
    return build(Math.round(clamp(artOnlyBudget, RAIL_MINI_ART_MIN, artCap)), false);
  }

  // Controls only.
  return { ...empty, controlSize: controls, blockHeight: controls + RAIL_MINI_TOP_MARGIN };
}

/** Rail contents fit their rail. The test pins this; the renderer relies on it. */
export function railContentsFit(layout: ShellLayout): boolean {
  return (
    layout.navItemHeight * NAV_ITEM_COUNT + layout.miniPlayer.blockHeight <=
    layout.railHeight
  );
}

export { NAV_ITEM_COUNT as SHELL_NAV_ITEM_COUNT };

import { layout as layoutTokens } from '../theme/spacing.ts';
import { MAX_FONT_SCALE, variantLineHeight } from '../theme/typography.ts';

/**
 * App shell navigation geometry. Three shapes, picked by what the window can
 * actually seat:
 *
 * - **tabs** — a phone. Bottom tab bar with the mini-player pill floating above
 *   it. The pill is out of the bar's layout flow, so the scene has to reserve
 *   `sceneBottomInset` for it.
 * - **rail** — a landscape window, only ~411dp tall, where that chrome costs
 *   152dp. Navigation moves to a vertical rail down the leading edge with the
 *   mini player docked at its foot, handing the height back to the scene.
 * - **split** — a window wide enough to seat the nav items and the mini player
 *   *beside* each other in one bottom row. Costs one bar instead of a bar plus
 *   a pill, and gives the mini player room to be legible rather than cramped.
 *
 * Each shape's binding constraint is different — the rail's is its own height,
 * the split bar's is its width — so each gets its own fitting function with
 * declared sizes rather than estimates, the same way
 * `components/player/nowPlayingLayout.ts` does. In both cases the nav items
 * concede padding before the mini player concedes content.
 */

export type ShellNavigationMode = 'tabs' | 'rail' | 'split';

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

/**
 * Tallest window still better off with a rail than with a bottom bar.
 *
 * The rail answers scarce *height*, not landscape — a tablet in landscape is
 * short relative to its width but still ~800dp tall, and wearing a phone's
 * solution there costs it width for no reason.
 *
 * The number moved when the split bar arrived. Bottom chrome used to mean a
 * 56dp bar *plus* a 76dp floating pill stacked above it; the split bar seats
 * both in one ~64dp row. A window with this much height spends well under a
 * tenth of it on that and keeps its full width, which is the better trade. A
 * shorter one does not, and pays 104dp of width instead.
 */
const RAIL_MAX_WINDOW_HEIGHT = 600;

const RAIL_MINI_ART_MAX = 72;
const RAIL_MINI_ART_MIN = 40;
const RAIL_MINI_CONTROL_SIZE = 36;
const RAIL_MINI_PROGRESS_HEIGHT = 2;
const RAIL_MINI_GAP = 6;
/** Breathing room between the last nav item and the mini player. Exported so
 * the renderer subtracts exactly what `blockHeight` reserved. */
export const RAIL_MINI_TOP_MARGIN = 16;

/* ── split bar ──────────────────────────────────────────────────────────── */

/**
 * The split shape is **two peer cards floating over the scene**, not a chrome
 * slab with a player dropped onto it. Both carry the same surface as the phone's
 * mini-player pill, so nav and playback read as siblings rather than as one
 * thing stuck to another — which is the whole difference between deliberate and
 * slapped on.
 *
 * Because they float, the scene has to reserve `sceneBottomInset` for them, the
 * same contract the pill has.
 */

/**
 * Seats a 44dp artwork square, and an icon-over-label nav item *plus* the
 * selection indicator above it — the card clips to its own rounded edge, so the
 * indicator has to live inside the card's padding rather than flush to its top.
 */
const SPLIT_BAR_HEIGHT = 72;
const SPLIT_NAV_ITEM_IDEAL_WIDTH = 88;
/** Floor before a nav item's label starts truncating. */
const SPLIT_NAV_ITEM_MIN_WIDTH = 64;
/**
 * Nav items tighten while a player pane is up — the nav card is no longer the
 * co-star of the bar, so it steps back and gives the pane the emphasis.
 *
 * Declared, not incidental. This shrink first appeared as a side effect of the
 * bar reserving room for a player card it had stopped rendering; the effect
 * looked right, so it is now a stated intent with the items animating in step
 * with the card rather than snapping inside it.
 */
const SPLIT_NAV_ITEM_DOCKED_WIDTH = 64;
/** Below this the mini player can't hold artwork, two text lines and two controls. */
const SPLIT_MINI_MIN_WIDTH = 280;
/** A player card, not a smear. Past this the pair centres instead of stretching. */
const SPLIT_MINI_MAX_WIDTH = 560;
/** The "split" itself: the visible gap between the two cards. */
export const SPLIT_GAP = 12;
/** Breathing room between the cards and the window edges. */
export const SPLIT_BAR_MARGIN = 12;
/** Inset inside the nav card, so its items aren't flush to its own corners. */
export const SPLIT_CARD_PADDING = 8;
/** The selection indicator bar plus a little air under it. */
const SPLIT_INDICATOR_CLEARANCE = 8;
const SPLIT_MINI_ART = 44;
const SPLIT_MINI_CONTROL = 40;

/**
 * Narrowest window that can seat both cards at their floors. Derived rather
 * than declared so it can't drift from the parts it's the sum of — a phone
 * (412dp) stays on tabs, a tablet in either orientation and an unfolded
 * foldable clear it.
 */
const SPLIT_MIN_CONTENT_WIDTH =
  SPLIT_NAV_ITEM_MIN_WIDTH * NAV_ITEM_COUNT +
  SPLIT_CARD_PADDING * 2 +
  SPLIT_GAP +
  SPLIT_MINI_MIN_WIDTH;

/**
 * Same, for a column that is already showing a dock — the player card is the
 * pane in that case, so only the nav card has to fit.
 *
 * Without this split, opening the dock knocked the column down to flat bottom
 * tabs on a foldable: it was still demanding room for a mini player it had
 * stopped rendering. Keeping the floating nav card means expanding the pane
 * changes one thing rather than restyling the whole bar underneath it.
 */
const SPLIT_MIN_CONTENT_WIDTH_DOCKED =
  SPLIT_NAV_ITEM_MIN_WIDTH * NAV_ITEM_COUNT + SPLIT_CARD_PADDING * 2;

/* ── player dock (tablet stage B) ───────────────────────────────────────── */

/**
 * The dock is a *toggle*, not a breakpoint: a window wide enough to seat one
 * offers it, and the user decides. That keeps the automatic shapes at three and
 * lets someone reclaim the width for browsing.
 *
 * It is sized as a share of the window rather than a constant, because it has
 * to leave a shell behind it — the split bar still needs room for both its
 * cards in what's left, and a fixed 560dp dock would strand a 1024dp tablet.
 */
const DOCK_WIDTH_RATIO = 0.36;
/** Narrower than this and it's a wide mini player, not a player. */
const DOCK_MIN_WIDTH = 340;
/** Wider than this it stops earning the width it takes from the library. */
const DOCK_MAX_WIDTH = 520;
/**
 * Column the scene keeps behind a dock. About a phone in portrait — enough to
 * browse a library in.
 *
 * Deliberately NOT "the split bar must still fit". Once the dock is up the
 * shell no longer carries a player, so it only has to seat *navigation*, and
 * demanding room for a mini player it will not render excluded windows for
 * space they did not need — which is what kept the dock off the Fold.
 */
const DOCK_MIN_SCENE_WIDTH = 420;
/**
 * Shortest window worth a dock. Equal to `RAIL_MAX_WINDOW_HEIGHT` on purpose:
 * a window short enough to want a rail is too short to also host a player
 * column, so the two shapes can never collide.
 */
const DOCK_MIN_HEIGHT = RAIL_MAX_WINDOW_HEIGHT;

export interface ShellInsets {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

export interface SplitBarLayout {
  /** Height of both cards. They are peers, so they match. */
  height: number;
  navItemWidth: number;
  /** Nav card width: its items plus its own padding. */
  navWidth: number;
  /** Player card width. */
  miniWidth: number;
  artSize: number;
  controlSize: number;
  /**
   * Vertical space the floating pair covers, margins included — what a scene
   * has to reserve so its last row isn't hidden behind them.
   */
  blockHeight: number;
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
  splitBar: SplitBarLayout;
  /**
   * Whether this window could seat a player dock at all. The toggle should be
   * hidden, not just disabled, when this is false — offering a control that
   * cannot do anything is worse than not offering it.
   */
  dockAllowed: boolean;
  /** True when the dock is both wanted and possible. */
  docked: boolean;
  /** Trailing-edge width the dock occupies; 0 when not docked. */
  dockWidth: number;
  /**
   * The width a dock *would* take on this window, whether or not one is open.
   * The open/close animation interpolates toward it, and the pane's contents
   * lay out at it once rather than re-flowing on every frame of the reveal.
   */
  dockCandidateWidth: number;
  /** Width the scene actually gets: the window minus the dock. */
  sceneWidth: number;
  /**
   * Trailing safe-area inset the *scene* owes. Zero while docked, because the
   * dock is the thing on that edge — the mirror of `ShellRailContext` taking
   * the leading inset. See `Screen`.
   */
  sceneInsetRight: number;
  /**
   * What a scrollable surface must reserve at its bottom so its last row isn't
   * hidden by chrome that sits *outside* the layout flow.
   *
   * Only `tabs` floats anything over the scene: `rail` docks the mini player in
   * the rail and `split` seats it in the bar, and both of those are in flow and
   * reserve their own space. Surfaces read this rather than
   * `layout.miniPlayerFloat` directly, or landscape pays for a pill that isn't
   * there.
   */
  sceneBottomInset: number;
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
  fontScale = 1,
  /**
   * The user's dock preference. Honoured only if the window can seat a dock
   * *and* still leave a working shell — see `dockAllowed`.
   */
  dockRequested = false
): ShellLayout {
  const scale = clamp(fontScale, 1, MAX_FONT_SCALE);
  // The dock takes its width off the trailing edge before anything else is
  // measured, so every shape below sizes to the content column rather than to
  // the window. Its own trailing safe-area inset is the dock's to pay.
  const dockCandidate = Math.round(
    clamp(width * DOCK_WIDTH_RATIO, DOCK_MIN_WIDTH, DOCK_MAX_WIDTH)
  );
  // Docked, the scene stops paying the trailing inset — the dock is what's on
  // that edge — so the column it keeps is measured without it.
  const contentIfDocked = width - dockCandidate - insets.left;
  // Landscape-ish and tall enough to be worth a player column, with a usable
  // scene left behind it. Portrait keeps the fullscreen player instead.
  const dockAllowed =
    width > height &&
    height >= DOCK_MIN_HEIGHT &&
    contentIfDocked >= DOCK_MIN_SCENE_WIDTH;
  const docked = dockRequested && dockAllowed;
  const dockWidth = docked ? dockCandidate : 0;
  // Everything below measures the column the scene actually gets, not the
  // window. The dock sits on the trailing edge, so it also inherits the
  // trailing safe-area inset — the scene stops paying it, exactly as the rail
  // takes the leading one.
  const sceneWidth = width - dockWidth;
  const sceneInsetRight = docked ? 0 : insets.right;
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

  const splitContentWidth = Math.max(
    0,
    sceneWidth - insets.left - sceneInsetRight - SPLIT_BAR_MARGIN * 2
  );
  const splitBar = fitSplitBar(splitContentWidth, scale, docked);

  // A rail is for a window that is landscape, short enough to actually need the
  // height back, wide enough to afford 104dp of it, and tall enough to host the
  // rail's own items at a pressable size. A window failing any of those is
  // worse off with a rail than without one.
  //
  // Split is the fallback rather than tabs whenever the width allows it: it
  // costs one bar instead of a bar plus a floating pill, so it is never the
  // worse choice for a window that can seat it. That catches both a tablet —
  // in either orientation — and a window too short for a rail but wide enough
  // to share a row.
  const mode: ShellNavigationMode =
    sceneWidth > height &&
    sceneWidth >= RAIL_MIN_WINDOW_WIDTH &&
    height < RAIL_MAX_WINDOW_HEIGHT &&
    navItemHeight >= NAV_ITEM_MIN_HEIGHT
      ? 'rail'
      : splitContentWidth >=
          (docked ? SPLIT_MIN_CONTENT_WIDTH_DOCKED : SPLIT_MIN_CONTENT_WIDTH)
        ? 'split'
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
    splitBar,
    dockAllowed,
    docked,
    dockWidth,
    dockCandidateWidth: dockAllowed ? dockCandidate : 0,
    sceneWidth,
    sceneInsetRight,
    // Both shapes that float chrome over the scene owe it the space back. The
    // rail is the only one that doesn't, because it sits beside the scene
    // rather than on top of it.
    sceneBottomInset:
      mode === 'tabs'
        // Docked, the pill is gone — the dock is the player — so the plain bar
        // is in flow and the scene owes nothing.
        ? (docked ? 0 : layoutTokens.miniPlayerFloat)
        : mode === 'split'
          ? splitBar.blockHeight + insets.bottom
          : 0,
  };
}

/**
 * Seat the two cards in one row of `availableWidth`.
 *
 * Same concession order as the rail: nav items give up width down to their own
 * floor before the player card is allowed to drop below a legible size.
 *
 * The two cards **divide the row** — the player takes whatever the nav card
 * doesn't, up to its cap. Only once *both* are capped is there slack, and the
 * renderer centres the pair rather than pushing them to opposite edges. A
 * tablet's bottom chrome should look composed, not like two things that drifted
 * apart.
 */
function fitSplitBar(
  availableWidth: number,
  scale: number,
  docked: boolean
): SplitBarLayout {
  // The card's own padding is part of the height, not on top of it: the nav
  // items live in the padded box so the selection indicator clears the clipped
  // rounded edge. A larger font setting grows the box rather than the overhang.
  const height = Math.max(
    SPLIT_BAR_HEIGHT,
    NAV_ICON_SIZE +
      NAV_LABEL_GAP +
      Math.ceil(variantLineHeight.caption * scale) +
      SPLIT_CARD_PADDING * 2 +
      SPLIT_INDICATOR_CLEARANCE
  );
  const cardChrome = SPLIT_CARD_PADDING * 2;
  const navAtIdeal = SPLIT_NAV_ITEM_IDEAL_WIDTH * NAV_ITEM_COUNT + cardChrome;
  // Docked, the nav card steps back to its compact width — see
  // SPLIT_NAV_ITEM_DOCKED_WIDTH. It is sized from a declared constant rather
  // than from whatever is left over after reserving for a player card that is
  // no longer rendered, which is what it used to do by accident.
  const navItemWidth = docked
    ? clamp(
        SPLIT_NAV_ITEM_DOCKED_WIDTH,
        SPLIT_NAV_ITEM_MIN_WIDTH,
        Math.floor((availableWidth - cardChrome) / NAV_ITEM_COUNT)
      )
    : availableWidth - navAtIdeal - SPLIT_GAP >= SPLIT_MINI_MIN_WIDTH
      ? SPLIT_NAV_ITEM_IDEAL_WIDTH
      : clamp(
          Math.floor(
            (availableWidth - SPLIT_GAP - SPLIT_MINI_MIN_WIDTH - cardChrome) /
              NAV_ITEM_COUNT
          ),
          SPLIT_NAV_ITEM_MIN_WIDTH,
          SPLIT_NAV_ITEM_IDEAL_WIDTH
        );
  const navWidth = navItemWidth * NAV_ITEM_COUNT + cardChrome;
  const miniWidth = docked
    ? 0
    : clamp(availableWidth - navWidth - SPLIT_GAP, 0, SPLIT_MINI_MAX_WIDTH);
  return {
    height,
    navItemWidth,
    navWidth,
    miniWidth,
    // Artwork is square, so the card's height caps it as well as the token does.
    artSize: Math.min(SPLIT_MINI_ART, height - 12),
    controlSize: SPLIT_MINI_CONTROL,
    blockHeight: height + SPLIT_BAR_MARGIN * 2,
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

/**
 * Both cards fit their row, given the window they were measured for. The
 * renderer centres the pair, which is only safe while this holds.
 */
export function splitBarContentsFit(
  layout: ShellLayout,
  width: number,
  insets: ShellInsets
): boolean {
  const available = width - insets.left - insets.right - SPLIT_BAR_MARGIN * 2;
  return layout.splitBar.navWidth + SPLIT_GAP + layout.splitBar.miniWidth <= available;
}

export { NAV_ITEM_COUNT as SHELL_NAV_ITEM_COUNT };

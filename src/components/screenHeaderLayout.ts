import { spacing } from '../theme/spacing.ts';
import { MAX_FONT_SCALE, fontSize, variantLineHeight } from '../theme/typography.ts';
import { DETAIL_BAR_H } from './library/detailHeroLayout.ts';

/**
 * Geometry and motion for the collapsing page header (Material 3 large title →
 * compact top app bar).
 *
 * Every number here is *declared*, never measured. That is the whole point.
 * An earlier attempt made the header an overlay and had each list re-pay its
 * **measured** height as `contentContainerStyle.paddingTop`; the measurement and
 * the padding are two copies of one number that must agree at every font scale
 * and orientation, and on device they didn't. Here `contentPaddingTop` is
 * computed once, from constants, and handed to the list — there is no second
 * copy to disagree with.
 *
 * The collapse is a *travel*, not a crossfade. A second attempt scrolled the
 * large title away and faded a small one in; it worked and looked wrong. One
 * text object moves: it rises, shrinks, and slides in beside the back chevron,
 * the way `CollapsingDetail` flies album artwork into its bar thumbnail.
 *
 * The interpolations live here too, as pure functions, so the motion that ships
 * and the motion the tests sweep are the same code.
 */

/** Collapsed bar height. Shared with the library detail screens on purpose: two
 * bar heights in one app reads as a bug when navigating between them. */
export const SCREEN_BAR_H = DETAIL_BAR_H;

/** Left edge of the expanded title — the standard `Screen` content gutter. */
export const SCREEN_HEADER_GUTTER = spacing.lg;
/** Chevron inset. Matches `CollapsingDetail`, so it is a fixed point across the
 * whole navigation chain rather than jumping 4dp on push. */
const CHEVRON_LEFT = spacing.md;
const CHEVRON_SIZE = 24;
/** Where bar-height text starts. Verbatim from `CollapsingDetail`, so the back
 * label and the collapsed title share one x with the detail screens. */
const BAR_TEXT_LEFT = spacing.md + 26;
/** Top of the large title, below the inset. Clears the chevron row entirely. */
const TITLE_TOP = SCREEN_BAR_H + spacing.md;
const TITLE_TO_SUB = spacing.xs;
/** Gap below the title block to the header's bottom edge, where row 1 rests. */
const BLOCK_BOTTOM_PAD = spacing.lg;
/** Collapsed title size. Matches `CollapsingDetail`'s bar title. */
const BAR_TITLE_SIZE = 18;

/** Bar action target. Exported so `ScreenHeaderAction` sizes itself from the
 * same number the collision invariant is proved against. */
export const SCREEN_HEADER_ACTION_SIZE = 40;
const ACTION_SIZE = SCREEN_HEADER_ACTION_SIZE;
const ACTION_GAP = spacing.xs;
const ACTION_RIGHT = spacing.md;

/**
 * Floor on how far the header travels.
 *
 * A title-only header is naturally 117dp, giving only 69dp of collapse — most of
 * the settings screens are title-only, and at that distance the travel reads as
 * a twitch rather than a movement. The bottom pad absorbs the shortfall: a
 * computed number sizing the header, never moving a control.
 */
const MIN_COLLAPSE_DISTANCE = 72;

/**
 * Shortest window that gets a large title at all.
 *
 * Sits just under the rail's own 600dp threshold (`RAIL_MAX_WINDOW_HEIGHT` in
 * navigation/shellLayout.ts), which excludes every phone in landscape while
 * leaving a 568dp-tall portrait phone — which never gets a rail — its large
 * title. Tablets clear it in both orientations.
 */
const COLLAPSIBLE_MIN_WINDOW_HEIGHT = 560;

/**
 * List that must survive under an expanded header for collapsing to be worth it.
 *
 * The height threshold alone is a magic number; this is the check that actually
 * matters, and it means a window we failed to anticipate degrades to the static
 * bar instead of showing a header with two rows under it.
 */
const MIN_LIST_STRIP = 240;

/** Fraction of the collapse by which the travel has finished, leaving a short
 * tail where only the bar background is still resolving. */
const SETTLE_SHARE = 0.88;
/** Stagger, as fractions of `settle` — never absolute dp, or the motion would
 * change character between a 72dp header and a 100dp one. */
const TITLE_SCALE_START = 0.3;
const TITLE_X_START = 0.45;
const BAR_FADE_START = 0.4;
const BAR_FADE_END = 0.85;
/**
 * Strictly below `TITLE_X_START`, and that ordering is load-bearing.
 *
 * The back label and the collapsed title occupy the *same* slot — both start at
 * `BAR_TEXT_LEFT`. If their fades overlapped you would watch two strings dissolve
 * through each other in one spot, which is the crossfade this header exists to
 * replace. The label must be gone before the title starts sliding in.
 */
const LABEL_FADE_SHARE = 0.4;
/** The back label is short-lived on any header; cap it so it never lingers. */
const LABEL_FADE_MAX = 45;
const SUBTITLE_FADE_SHARE = 0.5;
const SUBTITLE_LIFT = -12;

export interface ScreenHeaderInput {
  /** Width inside `Screen`'s insets — not the window width. */
  availableWidth: number;
  windowHeight: number;
  topInset: number;
  fontScale: number;
  hasSubtitle: boolean;
  hasBack: boolean;
  actionCount: number;
  /**
   * False on a screen whose destination is already named elsewhere — Library in
   * rail mode, where the rail carries the word. The header then contributes no
   * title and no bar, only its chrome.
   */
  hasTitle?: boolean;
  /**
   * Pinned controls that sit below the title and must stay reachable — Library's
   * view switcher and sort row.
   *
   * Declared by the caller, never measured. It rides up as the title collapses
   * (it is anchored to the container's bottom edge), so at rest the list clears
   * title + chrome and once collapsed it clears bar + chrome. A caller passing
   * this **must** give the chrome an explicit height so the declaration is true
   * by construction rather than by hope.
   */
  chromeHeight?: number;
}

export interface ScreenHeaderLayout {
  /** False on windows too short for a large title: a static bar, no motion. */
  collapsible: boolean;
  /** Whether a title/bar is drawn at all. False leaves only the chrome. */
  hasTitle: boolean;
  /** Zero when there is no title, so the chrome becomes the whole header. */
  barHeight: number;
  /** Title area height below the top inset, chrome NOT included. */
  expandedHeight: number;
  /** Pinned controls below the title, as declared by the caller. */
  chromeHeight: number;
  /**
   * What the scroll surface owes as `contentContainerStyle.paddingTop`.
   *
   * The single source for this number. Nothing else may derive it.
   */
  contentPaddingTop: number;
  /** Scroll distance over which the header collapses. Zero when static. */
  dist: number;
  /** Scroll offset by which the travel has finished. Zero when static. */
  settle: number;
  /** Header height at rest, inset included — the backdrop's fixed height. */
  maxHeight: number;
  /** Header height once collapsed, inset included. */
  minHeight: number;
  titleLine: number;
  subLine: number;
  /** Top of the large title, below the inset. */
  titleTop: number;
  titleLeft: number;
  /** Top of the subtitle line, below the inset. */
  subtitleTop: number;
  /** Collapsed size as a share of the expanded size. Font-scale independent, so
   * the collapsed title still honours the system font setting. */
  titleScale: number;
  travelX: number;
  /** Independent of `topInset` — it cancels — so the motion is identical on
   * every device and provable without one. */
  travelY: number;
  /** Absolute y of the bar's vertical centre, inset included. */
  barCenterY: number;
  chevronLeft: number;
  chevronSize: number;
  barTextLeft: number;
  /** Right bound for the back label, so it ellipsizes clear of the actions. */
  labelRight: number;
  /** Horizontal space the action cluster occupies, measured from the right edge. */
  actionsWidth: number;
  actionsRight: number;
  actionSize: number;
  actionGap: number;
  /** Right edge the collapsed title reaches. Must clear the actions. */
  collapsedTitleRight: number;
}

// Marked as a worklet because `lerpClamped` calls it from the UI thread. A
// plain helper called out of a worklet crashes at runtime — see
// listening/activityChartMath.ts, which marks its own clamp for the same reason.
// Still callable normally from `getScreenHeaderLayout` on the JS thread.
function clamp(value: number, min: number, max: number): number {
  'worklet';
  return Math.min(max, Math.max(min, value));
}

export function getScreenHeaderLayout({
  availableWidth,
  windowHeight,
  topInset,
  fontScale,
  hasSubtitle,
  hasBack,
  actionCount,
  hasTitle = true,
  chromeHeight = 0,
}: ScreenHeaderInput): ScreenHeaderLayout {
  const scale = clamp(fontScale, 1, MAX_FONT_SCALE);
  const titleLine = Math.round(variantLineHeight.title * scale);
  const subLine = Math.round(variantLineHeight.label * scale);

  const contentBlock =
    TITLE_TOP +
    titleLine +
    (hasSubtitle ? TITLE_TO_SUB + subLine : 0) +
    BLOCK_BOTTOM_PAD;
  const natural = Math.max(contentBlock, SCREEN_BAR_H + MIN_COLLAPSE_DISTANCE);

  // The chrome is part of what the list must clear, so it counts against the
  // strip the same way the title does — otherwise a screen with tall chrome
  // would collapse into a viewport with two rows in it.
  const collapsible =
    hasTitle &&
    windowHeight >= COLLAPSIBLE_MIN_WINDOW_HEIGHT &&
    windowHeight - topInset - natural - chromeHeight >= MIN_LIST_STRIP;

  const barHeight = hasTitle ? SCREEN_BAR_H : 0;
  const expandedHeight = collapsible ? natural : barHeight;
  const dist = expandedHeight - barHeight;

  const actionsWidth =
    actionCount > 0
      ? ACTION_RIGHT + actionCount * ACTION_SIZE + (actionCount - 1) * ACTION_GAP
      : 0;
  const titleLeft = SCREEN_HEADER_GUTTER;
  const travelX = hasBack ? BAR_TEXT_LEFT - titleLeft : 0;
  const titleScale = BAR_TITLE_SIZE / fontSize.xxl;
  const titleWidth = Math.max(0, availableWidth - titleLeft * 2);

  return {
    collapsible,
    hasTitle,
    barHeight,
    expandedHeight,
    chromeHeight,
    contentPaddingTop: topInset + expandedHeight + chromeHeight,
    dist,
    settle: Math.round(dist * SETTLE_SHARE),
    maxHeight: topInset + expandedHeight + chromeHeight,
    minHeight: topInset + barHeight + chromeHeight,
    titleLine,
    subLine,
    titleTop: TITLE_TOP,
    titleLeft,
    subtitleTop: TITLE_TOP + titleLine + TITLE_TO_SUB,
    titleScale,
    travelX,
    travelY: SCREEN_BAR_H / 2 - (TITLE_TOP + titleLine / 2),
    barCenterY: topInset + SCREEN_BAR_H / 2,
    chevronLeft: CHEVRON_LEFT,
    chevronSize: CHEVRON_SIZE,
    barTextLeft: BAR_TEXT_LEFT,
    labelRight: actionsWidth > 0 ? actionsWidth + spacing.sm : spacing.md,
    actionsWidth,
    actionsRight: ACTION_RIGHT,
    actionSize: ACTION_SIZE,
    actionGap: ACTION_GAP,
    collapsedTitleRight: titleLeft + travelX + titleWidth * titleScale,
  };
}

/* ------------------------------------------------------------------ motion */

/**
 * The interpolations, as pure functions of scroll offset.
 *
 * Kept out of `useAnimatedStyle` so `node --test` can sweep the *motion* rather
 * than only the resting geometry — the header clipping its own title mid-travel
 * is exactly the class of bug that shipped last time and was only visible on a
 * device. Each takes primitives, never the layout object, so a Reanimated
 * closure captures numbers and not a fresh object identity every render.
 */

function lerpClamped(
  value: number,
  inStart: number,
  inEnd: number,
  outStart: number,
  outEnd: number
): number {
  'worklet';
  if (inEnd <= inStart) return value <= inStart ? outStart : outEnd;
  const t = clamp((value - inStart) / (inEnd - inStart), 0, 1);
  return outStart + t * (outEnd - outStart);
}

/** Header height, inset included. Collapses 1:1 with scroll so rows appear to
 * stay put under the finger. */
export function headerHeightAt(
  y: number,
  dist: number,
  maxHeight: number,
  minHeight: number
): number {
  'worklet';
  return lerpClamped(y, 0, dist, maxHeight, minHeight);
}

/** Rises first — the whole travel, so the title leads the collapse. */
export function titleLiftAt(y: number, settle: number, travelY: number): number {
  'worklet';
  return lerpClamped(y, 0, settle, 0, travelY);
}

/** Shrinks second. */
export function titleScaleAt(y: number, settle: number, titleScale: number): number {
  'worklet';
  return lerpClamped(y, settle * TITLE_SCALE_START, settle, 1, titleScale);
}

/** Slides in beside the chevron last, so the path reads as a curve. */
export function titleSlideAt(y: number, settle: number, travelX: number): number {
  'worklet';
  return lerpClamped(y, settle * TITLE_X_START, settle, 0, travelX);
}

/** The back label gives up its row to the title. */
export function labelOpacityAt(y: number, settle: number): number {
  'worklet';
  return lerpClamped(y, 0, Math.min(LABEL_FADE_MAX, settle * LABEL_FADE_SHARE), 1, 0);
}

export function subtitleOpacityAt(y: number, settle: number): number {
  'worklet';
  return lerpClamped(y, 0, settle * SUBTITLE_FADE_SHARE, 1, 0);
}

export function subtitleLiftAt(y: number, settle: number): number {
  'worklet';
  return lerpClamped(y, 0, settle * SUBTITLE_FADE_SHARE, 0, SUBTITLE_LIFT);
}

/** Arrives last: the surface only earns its tint once content is behind it. */
export function barOpacityAt(y: number, settle: number): number {
  'worklet';
  return lerpClamped(y, settle * BAR_FADE_START, settle * BAR_FADE_END, 0, 1);
}

/**
 * Vertical extent of the travelling title at a given scroll offset, below the
 * inset. Exists so the tests can prove the header never clips its own title.
 */
export function titleBoundsAt(
  y: number,
  layout: ScreenHeaderLayout
): { top: number; bottom: number } {
  const centre =
    layout.titleTop +
    layout.titleLine / 2 +
    titleLiftAt(y, layout.settle, layout.travelY);
  const half =
    (layout.titleLine / 2) * titleScaleAt(y, layout.settle, layout.titleScale);
  return { top: centre - half, bottom: centre + half };
}

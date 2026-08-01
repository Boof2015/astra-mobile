import { spacing } from '../../theme/spacing.ts';
import { MAX_FONT_SCALE, variantLineHeight } from '../../theme/typography.ts';
import { WIDE_MIN_WIDTH, isWideWindow } from '../../theme/adaptive.ts';

/**
 * Now Playing geometry.
 *
 * The portrait screen is two regions: a rigid **deck** of controls whose height
 * is a sum of declared constants, and an elastic **stage** above it holding the
 * artwork and scope. The deck is rendered at exactly `deckHeight` and the stage
 * takes the rest via `flex: 1`, so the numbers here and Yoga's numbers agree by
 * construction. Nothing in this module can move a control — the only thing it
 * decides is how big the artwork gets.
 *
 * Deck heights are picked from one of three density tiers rather than derived
 * from raw window dimensions. Within a tier the deck is identical on every
 * device; only the artwork changes size. That is what keeps the screen feeling
 * like the same screen across a phone lineup.
 */

const MAX_CONTENT_WIDTH = 408;
const CONTENT_SIDE_PADDING = spacing.lg;
const TABLET_MAX_CONTENT_WIDTH = 520;
const TABLET_ART_SIZE_MAX = 440;

/**
 * A window this size stacks — artwork over a deck — rather than putting the
 * artwork beside the controls.
 *
 * Side-by-side exists for one reason: a phone in landscape is ~340dp tall and
 * cannot stack. It is not a "big screen" layout, and routing tablets into it via
 * `isWideWindow` is what made a 10" tablet read as an enlarged landscape phone.
 * The question is the same one the navigation rail and the EQ both ask — is
 * there height to stack — not whether the window happens to be landscape.
 */
const TABLET_STACK_MIN_WIDTH = 600;
const TABLET_STACK_MIN_HEIGHT = 620;

/**
 * Stacked-tablet ceilings.
 *
 * The deck runs wider than a phone's — the waveform is the one control that
 * turns width into resolution — but only so far. Past roughly half a 10" tablet
 * the extra width stops buying a better scrub and starts stretching the rows
 * around it: the title at the far left and the favourite toggle at the far
 * right with a void between them, the same failure as a full-width `TrackRow`.
 * At this cap the deck also lands at the scope rail's width, so the two read as
 * one column under the artwork rather than two different measures.
 *
 * The artwork keeps a ceiling of its own: it is square, so it can only spend
 * height, and past this it stops being artwork and starts being a wall.
 */
const TABLET_STACK_MAX_CONTENT_WIDTH = 640;
const TABLET_STACK_ART_SIZE_MAX = 560;
const TABLET_STACK_SCOPE_WIDTH_MAX = 640;
export const NOW_PLAYING_WIDE_PANE_GAP = spacing.xxl;
const WIDE_RIGHT_PANE_MIN = 300;
/**
 * Landscape deck pane cap. Height is the scarce resource in landscape and the
 * artwork is square, so it can never spend the surplus width — the deck is the
 * only pane that can, and a longer seek bar is the point. Was aliased to the
 * portrait column width (408), which left 100-150dp of a phone's landscape row
 * simply unused.
 */
const WIDE_RIGHT_PANE_MAX = 560;
const WIDE_ART_SIZE_MIN = 160;

/**
 * Ceilings for the landscape row. Two declared sets, not one scaled number.
 *
 * The originals were tuned against a phone in landscape — ~411dp tall — where
 * they never actually bind, because the artwork runs out of *height* long before
 * it reaches 400dp. Reusing them on a tablet is what left a 10" screen with
 * 400dp artwork, a 960dp row inside a 1248dp window, and ~250dp of dead space
 * under the deck: the caps were doing nothing on the device they were written
 * for and everything on the device they weren't.
 *
 * The tablet set is what lets the artwork actually be the subject of the screen.
 * A window has to clear both a height and a width bar to get it — height because
 * that is what the artwork is bound by, width because a tall narrow window has
 * nowhere to put the deck.
 */
interface WideRowCaps {
  artMax: number;
  rowMax: number;
  /**
   * The scope strip's ceiling moves with the artwork's, or raising one alone
   * inverts them: at 640dp of art against the phone's 448dp strip cap, the
   * "rail under the artwork" becomes a box narrower than what it sits under.
   * The tablet number is set to leave the deck ~400dp once the stage has taken
   * its share, rather than to any ratio.
   */
  scopeMax: number;
}
const WIDE_CAPS_PHONE: WideRowCaps = { artMax: 400, rowMax: 960, scopeMax: 448 };
const WIDE_CAPS_TABLET: WideRowCaps = { artMax: 640, rowMax: 1160, scopeMax: 720 };
const WIDE_TABLET_MIN_HEIGHT = 640;
const WIDE_TABLET_MIN_WIDTH = 900;

function wideRowCaps(availableWidth: number, availableHeight: number): WideRowCaps {
  return availableHeight >= WIDE_TABLET_MIN_HEIGHT && availableWidth >= WIDE_TABLET_MIN_WIDTH
    ? WIDE_CAPS_TABLET
    : WIDE_CAPS_PHONE;
}
/**
 * How much wider than the artwork the scope strip runs. Mirrors the portrait
 * proportion (~1.5x), where the strip reads as a rail under the art rather than
 * a box beside it.
 */
const WIDE_SCOPE_WIDTH_RATIO = 1.5;
/** Below this the landscape artwork is too small to give the strip its share. */
const WIDE_SCOPE_RAIL_MIN_ART = 120;
const VISUALIZER_WIDTH_MAX = 448;
const VISUALIZER_SIDE_PADDING = spacing.md;
const VISUALIZER_TOP_GAP = spacing.lg;
const VISUALIZER_BOTTOM_GAP = spacing.xs;
const VISUALIZER_HEIGHT_MIN = 84;
const VISUALIZER_HEIGHT_MAX = 96;
const VISUALIZER_HEIGHT_RATIO = 0.25;

export const NOW_PLAYING_HEADER_HEIGHT = 32;
export const NOW_PLAYING_CONTENT_TOP_PADDING = spacing.sm;
export const NOW_PLAYING_CONTENT_BOTTOM_PADDING = spacing.lg;
export const NOW_PLAYING_WAVEFORM_HEIGHT = 58;
export const NOW_PLAYING_WAVEFORM_TOUCH_PADDING = spacing.md;
export const NOW_PLAYING_PLAY_BUTTON_SIZE = 68;
export const NOW_PLAYING_SUB_BUTTON_SIZE = 40;

/**
 * Artwork below this reads as a thumbnail rather than the subject of the
 * screen, so a tier that would produce it gets passed over for a leaner one.
 * Set below the S22's scope-on size so a mid-size phone keeps the richer deck
 * rather than dropping a tier to buy artwork it doesn't need.
 */
const ART_COMFORT_MIN = 152;
/**
 * The same floor for a stacked tablet, where 152dp of artwork is not "small",
 * it is a thumbnail on a 10" screen.
 *
 * This is what stops a short, wide tablet from spending its column on the
 * richest deck: at 752dp of height the spacious deck takes 360 of it and leaves
 * the artwork under 300. Raising the bar makes the ladder step down to a leaner
 * deck and hand the difference to the artwork — which is the whole point of
 * stacking on a device this size.
 */
const TABLET_ART_COMFORT_MIN = 320;
/**
 * Artwork the scope rail must leave behind to be worth its stage space. Below
 * this the rail is dropped rather than squeezing the art into a thumbnail.
 */
const SCOPE_RAIL_MIN_ART = 96;

const TABLET_SHELL_MIN_WIDTH = 720;
const TABLET_SHELL_MAX_WIDTH = 1200;
const TABLET_COMPANION_GAP = spacing.xl;
/**
 * Companion widths, per companion.
 *
 * A queue row is a thumbnail plus two short lines and reads fine at 360dp. A
 * lyric line is a sentence, and at that width it breaks mid-phrase — the most
 * visible flaw in the panel. Lyrics therefore get a wider column; it is the
 * cheapest readability win available and costs the player nothing it was using.
 */
const TABLET_COMPANION_MIN_WIDTH = 320;
const TABLET_COMPANION_MAX_WIDTH = 400;
const TABLET_COMPANION_LYRICS_MIN_WIDTH = 440;
const TABLET_COMPANION_LYRICS_MAX_WIDTH = 760;
const TABLET_COMPANION_WIDTH_RATIO = 0.34;
/**
 * Lyrics take the majority of the shell, not a sidecar's share. A queue row is
 * a thumbnail and two short lines; a lyric line is a sentence, and at half the
 * screen it is still breaking mid-phrase.
 */
const TABLET_COMPANION_LYRICS_WIDTH_RATIO = 0.6;
/**
 * The player never gives up more than this, however much the companion wants.
 * It is what keeps the artwork the subject on a narrow shell — an unfolded
 * foldable would otherwise hand the lyrics 60% of 776dp and leave the player a
 * 280dp strip.
 */
const TABLET_PLAYER_REGION_MIN = 420;

export type NowPlayingPresentation = 'standard' | 'wide';
export type NowPlayingDensity = 'spacious' | 'regular' | 'compact';

/**
 * One complete set of deck tokens. Every field is a declared height — there are
 * no estimates here, which is what lets `getDeckHeight` be exact.
 */
interface DensityTier {
  density: NowPlayingDensity;
  /** Reserved lines in the cached-lyric row; 0 drops the row entirely. */
  lyricLines: number;
  /** Gap binding the lyric row to the title beneath it. Deliberately much
   * tighter than rowGap: the row is empty on most tracks, and at rowGap it read
   * as a void in the middle of the screen rather than leading above the title. */
  lyricGap: number;
  /** Gap between the title line box and the artist line box. */
  identityGap: number;
  waveformHeight: number;
  /** Grab margin above and below the waveform canvas. Real layout space, so it
   * has to be in the row height too. */
  waveformTouchPadding: number;
  /** Gap between the waveform canvas and the elapsed/remaining row. */
  timesGap: number;
  playButtonSize: number;
  subButtonSize: number;
  transportRowHeight: number;
  utilityRowHeight: number;
  /** Gap between deck groups. */
  rowGap: number;
  /** Tighter gap binding progress + transport into one control block. */
  controlGap: number;
  artMax: number;
  /** Clearance the artwork keeps from the header above and the deck below. */
  stageInset: number;
  scopeTopGap: number;
  scopeBottomGap: number;
}

const TIERS: readonly DensityTier[] = [
  {
    density: 'spacious',
    lyricLines: 1,
    lyricGap: 6,
    identityGap: spacing.xs,
    waveformHeight: 64,
    waveformTouchPadding: NOW_PLAYING_WAVEFORM_TOUCH_PADDING,
    timesGap: 6,
    playButtonSize: 68,
    subButtonSize: 40,
    transportRowHeight: 68,
    utilityRowHeight: 48,
    rowGap: 20,
    controlGap: spacing.md,
    artMax: 320,
    stageInset: 20,
    scopeTopGap: VISUALIZER_TOP_GAP,
    scopeBottomGap: VISUALIZER_BOTTOM_GAP,
  },
  {
    density: 'regular',
    lyricLines: 1,
    lyricGap: 6,
    identityGap: spacing.xs,
    waveformHeight: NOW_PLAYING_WAVEFORM_HEIGHT,
    waveformTouchPadding: NOW_PLAYING_WAVEFORM_TOUCH_PADDING,
    timesGap: spacing.xs,
    playButtonSize: 64,
    subButtonSize: 40,
    transportRowHeight: 64,
    utilityRowHeight: 44,
    rowGap: spacing.lg,
    controlGap: 10,
    artMax: 300,
    stageInset: spacing.lg,
    scopeTopGap: VISUALIZER_TOP_GAP,
    scopeBottomGap: VISUALIZER_BOTTOM_GAP,
  },
  {
    density: 'compact',
    lyricLines: 0,
    lyricGap: 0,
    identityGap: 2,
    waveformHeight: 44,
    waveformTouchPadding: spacing.sm,
    timesGap: spacing.xs,
    playButtonSize: 56,
    subButtonSize: 36,
    transportRowHeight: 56,
    utilityRowHeight: 40,
    rowGap: 10,
    controlGap: spacing.sm,
    artMax: 260,
    stageInset: 10,
    scopeTopGap: spacing.sm,
    scopeBottomGap: spacing.xs,
  },
] as const;

/** Line box the cached-lyric peek reserves per line, before font scaling. */
export const NOW_PLAYING_LYRIC_LINE_HEIGHT = 22;
const LYRIC_LINE_HEIGHT = NOW_PLAYING_LYRIC_LINE_HEIGHT;
/** Slack inside the lyric row so descenders on the second line aren't clipped. */
const LYRIC_ROW_PADDING = spacing.xs;

export interface NowPlayingDeck {
  density: NowPlayingDensity;
  /** Total rendered height. The deck is laid out at exactly this. */
  height: number;
  /** 0 when this tier has no room for the cached-lyric peek. */
  lyricRowHeight: number;
  lyricGap: number;
  identityRowHeight: number;
  titleLineHeight: number;
  artistLineHeight: number;
  identityGap: number;
  progressRowHeight: number;
  waveformHeight: number;
  waveformTouchPadding: number;
  timesGap: number;
  timesRowHeight: number;
  transportRowHeight: number;
  playButtonSize: number;
  subButtonSize: number;
  utilityRowHeight: number;
  rowGap: number;
  controlGap: number;
}

export interface NowPlayingLayout {
  presentation: NowPlayingPresentation;
  isWide: boolean;
  density: NowPlayingDensity;
  contentPadding: number;
  contentWidth: number;
  leftPaneWidth: number;
  rightPaneWidth: number;
  deck: NowPlayingDeck;
  /** Height the stage region resolves to. Stage renders as `flex: 1`; this is
   * the same number, used to size the artwork. */
  stageHeight: number;
  /** Clearance kept at the top and bottom of the stage. */
  stageInset: number;
  /** Vertical space the scope rail claims inside the stage inset; 0 when the
   * window is too short to give it any. */
  scopeBlockHeight: number;
  /** Rail offset from the stage's bottom edge, inset included. */
  railBottomOffset: number;
  /** False when the stage has no room for the rail, so the caller skips it. */
  scopeRailFits: boolean;
  artSize: number;
  /** Art size with the scope rail shown / hidden, regardless of the current
   * state — both are returned so the rail toggle can animate between them. */
  artSizeScopeOn: number;
  artSizeScopeOff: number;
  scopeWidth: number;
  scopeHeight: number;
  visualizerTopGap: number;
  visualizerBottomGap: number;
}

export interface TabletCompanionLayout {
  presentation: 'tablet-companion';
  shellWidth: number;
  playerRegionWidth: number;
  companionWidth: number;
  gap: number;
  playerLayout: NowPlayingLayout;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Natural scope strip height for a given width (~3.6:1, clamped). */
export function getScopeHeight(scopeWidth: number): number {
  return Math.round(
    clamp(scopeWidth * VISUALIZER_HEIGHT_RATIO, VISUALIZER_HEIGHT_MIN, VISUALIZER_HEIGHT_MAX)
  );
}

/**
 * Deck geometry for a tier at a given font scale.
 *
 * Text-bearing rows reserve real line boxes (see `variantLineHeight`) scaled by
 * the effective font scale, because React Native applies `allowFontScaling` to
 * lineHeight as well as fontSize. Nothing here is measured or guessed, so the
 * caller can render the deck at `height` and know it fits.
 */
export function getDeckHeight(tier: DensityTier, fontScale: number): NowPlayingDeck {
  const scale = clamp(fontScale, 1, MAX_FONT_SCALE);
  const titleLineHeight = Math.ceil(variantLineHeight.heading * scale);
  const artistLineHeight = Math.ceil(variantLineHeight.body * scale);
  const timesRowHeight = Math.ceil(variantLineHeight.mono * scale);
  const identityRowHeight = titleLineHeight + tier.identityGap + artistLineHeight;
  const lyricRowHeight =
    tier.lyricLines > 0
      ? Math.ceil(LYRIC_LINE_HEIGHT * scale) * tier.lyricLines + LYRIC_ROW_PADDING
      : 0;
  const progressRowHeight =
    tier.waveformHeight +
    tier.waveformTouchPadding * 2 +
    tier.timesGap +
    timesRowHeight;

  // [ lyric ─lyricGap─ identity ] ─rowGap─
  // [ progress ─controlGap─ transport ] ─rowGap─ utility
  const identityGroup =
    lyricRowHeight > 0
      ? lyricRowHeight + tier.lyricGap + identityRowHeight
      : identityRowHeight;
  const controlGroup =
    progressRowHeight + tier.controlGap + tier.transportRowHeight;
  const height =
    identityGroup + controlGroup + tier.utilityRowHeight + tier.rowGap * 2;

  return {
    density: tier.density,
    height,
    lyricRowHeight,
    lyricGap: lyricRowHeight > 0 ? tier.lyricGap : 0,
    identityRowHeight,
    titleLineHeight,
    artistLineHeight,
    identityGap: tier.identityGap,
    progressRowHeight,
    waveformHeight: tier.waveformHeight,
    waveformTouchPadding: tier.waveformTouchPadding,
    timesGap: tier.timesGap,
    timesRowHeight,
    transportRowHeight: tier.transportRowHeight,
    playButtonSize: tier.playButtonSize,
    subButtonSize: tier.subButtonSize,
    utilityRowHeight: tier.utilityRowHeight,
    rowGap: tier.rowGap,
    controlGap: tier.controlGap,
  };
}

/**
 * Existing Now Playing layout calculator. Keep the numeric outputs stable for
 * phone, split-screen, foldable, and short-landscape windows.
 */
export function getNowPlayingLayout(
  availableWidth: number,
  availableHeight: number,
  showVisualizer: boolean,
  forceWide = false,
  fontScale = 1,
  /**
   * Treat this as a tablet column regardless of how narrow it is.
   *
   * The companion tier passes it, because *it* knows the window is a tablet
   * even when the pane has squeezed the player into 450dp. Inferring
   * tablet-ness from the region's own width would drop those columns back to
   * phone ceilings and the phone comfort floor the moment the lyrics pane got
   * wide — the artwork would shrink because the pane grew, which is backwards.
   * It cannot be inferred by lowering `TABLET_STACK_MIN_WIDTH` either: large
   * phones are 430-450dp wide in portrait and would be caught by it.
   */
  forceTabletStack = false
): NowPlayingLayout {
  // Stacking wins wherever it fits, including over `forceWide` — a tablet with
  // the companion pane out still has the height to stack, and the player must
  // not change shape just because a pane slid in beside it.
  const stacksAsTablet =
    forceTabletStack ||
    (availableWidth >= TABLET_STACK_MIN_WIDTH && availableHeight >= TABLET_STACK_MIN_HEIGHT);
  const isWide =
    !stacksAsTablet && (forceWide || isWideWindow(availableWidth, availableHeight));

  const columnHeight =
    availableHeight -
    NOW_PLAYING_CONTENT_TOP_PADDING -
    NOW_PLAYING_CONTENT_BOTTOM_PADDING -
    NOW_PLAYING_HEADER_HEIGHT;

  if (isWide) {
    const contentPadding = CONTENT_SIDE_PADDING;
    const caps = wideRowCaps(availableWidth, availableHeight);
    const rowSpace = Math.max(
      0,
      Math.min(availableWidth - contentPadding * 2, caps.rowMax)
    );

    /**
     * Solve one tier's landscape geometry.
     *
     * Panes sit side by side, so unlike portrait the deck costs the artwork no
     * height — the constraint is that the deck fits the column at all. The
     * artwork is height-bound in almost every landscape window, which is why
     * the panes are sized from their *contents* here and the pair is centred:
     * a proportional split gave a 160dp artwork a 432dp pane to rattle around
     * in, with a scope strip nearly three times its width beneath it.
     */
    const solve = (tier: DensityTier) => {
      const deck = getDeckHeight(tier, fontScale);
      // Budget against the *narrowest* the deck may be, so the artwork gets
      // first call on the row's width; the deck reclaims whatever is left over
      // once the stage has been sized (a longer waveform is worth having in
      // landscape, and it is the only thing here that can use loose width).
      const stageSpace = Math.max(
        0,
        rowSpace - NOW_PLAYING_WIDE_PANE_GAP - WIDE_RIGHT_PANE_MIN
      );
      const inner = Math.max(0, columnHeight - tier.stageInset * 2);
      const fitArt = (space: number) =>
        Math.round(Math.max(0, Math.min(space, stageSpace, caps.artMax)));

      // The strip's height follows its width, which follows the artwork, which
      // depends on the strip's height. Seed with the tallest strip it could be
      // and refine once — `getScopeHeight` is clamped to a 12dp band, so a
      // second pass is enough to land on a stable answer.
      let scopeHeight = VISUALIZER_HEIGHT_MAX;
      let scopeWidth = 0;
      let artScopeOn = 0;
      for (let pass = 0; pass < 2; pass += 1) {
        artScopeOn = fitArt(
          inner - (tier.scopeTopGap + scopeHeight + tier.scopeBottomGap)
        );
        scopeWidth = Math.round(
          clamp(
            artScopeOn * WIDE_SCOPE_WIDTH_RATIO,
            artScopeOn,
            Math.min(stageSpace, caps.scopeMax)
          )
        );
        scopeHeight = getScopeHeight(scopeWidth);
      }
      const artScopeOff = fitArt(inner);
      const naturalScopeBlock = tier.scopeTopGap + scopeHeight + tier.scopeBottomGap;
      const scopeRailFits = artScopeOn >= WIDE_SCOPE_RAIL_MIN_ART;
      return {
        tier,
        deck,
        scopeWidth,
        scopeHeight,
        artScopeOn: scopeRailFits ? artScopeOn : artScopeOff,
        artScopeOff,
        scopeBlockHeight: scopeRailFits ? naturalScopeBlock : 0,
        scopeRailFits,
        fits: deck.height <= columnHeight && artScopeOff >= WIDE_ART_SIZE_MIN,
      };
    };

    // Richest tier whose deck fits the column outright. In landscape the deck
    // is the thing that runs out of room first, so this replaces the old raw
    // `availableHeight < 480` threshold with the same ladder portrait uses.
    let solved = solve(TIERS[TIERS.length - 1]);
    for (const candidate of TIERS) {
      const attempt = solve(candidate);
      if (attempt.fits) {
        solved = attempt;
        break;
      }
    }

    const { tier, deck } = solved;
    const artSize = showVisualizer ? solved.artScopeOn : solved.artScopeOff;
    // Panes are content-sized and the row is centred by the shell being exactly
    // this wide. The deck takes the width the stage didn't need.
    const leftPaneWidth = Math.max(solved.artScopeOff, solved.scopeWidth);
    const rightPaneWidth = Math.round(
      clamp(
        rowSpace - NOW_PLAYING_WIDE_PANE_GAP - leftPaneWidth,
        WIDE_RIGHT_PANE_MIN,
        WIDE_RIGHT_PANE_MAX
      )
    );
    const contentWidth = leftPaneWidth + NOW_PLAYING_WIDE_PANE_GAP + rightPaneWidth;
    return {
      presentation: 'wide',
      isWide: true,
      density: deck.density,
      contentPadding,
      contentWidth,
      leftPaneWidth,
      rightPaneWidth,
      deck,
      stageHeight: columnHeight,
      stageInset: tier.stageInset,
      scopeBlockHeight: solved.scopeBlockHeight,
      railBottomOffset: 0,
      scopeRailFits: solved.scopeRailFits,
      artSize,
      artSizeScopeOn: solved.artScopeOn,
      artSizeScopeOff: solved.artScopeOff,
      scopeWidth: solved.scopeWidth,
      scopeHeight: solved.scopeHeight,
      visualizerTopGap: tier.scopeTopGap,
      visualizerBottomGap: tier.scopeBottomGap,
    };
  }

  const isTabletColumn = availableWidth >= WIDE_MIN_WIDTH;
  const contentPadding = CONTENT_SIDE_PADDING;
  const maxContentWidth = stacksAsTablet
    ? TABLET_STACK_MAX_CONTENT_WIDTH
    : isTabletColumn
      ? TABLET_MAX_CONTENT_WIDTH
      : MAX_CONTENT_WIDTH;
  const contentWidth = Math.max(
    0,
    Math.min(availableWidth - contentPadding * 2, maxContentWidth)
  );
  const scopeWidth = Math.max(
    0,
    Math.min(
      availableWidth - VISUALIZER_SIDE_PADDING * 2,
      stacksAsTablet ? TABLET_STACK_SCOPE_WIDTH_MAX : VISUALIZER_WIDTH_MAX
    )
  );
  const scopeHeight = getScopeHeight(scopeWidth);

  // The artwork is capped separately from the deck on purpose. It is square, so
  // a wider column buys it nothing — letting `contentWidth` size it is what
  // would turn a tablet's extra width into a wall of cover art instead of a
  // longer seek bar.
  const artWidthCap = (tier: DensityTier) =>
    Math.min(
      contentWidth,
      stacksAsTablet
        ? TABLET_STACK_ART_SIZE_MAX
        : isTabletColumn
          ? TABLET_ART_SIZE_MAX
          : tier.artMax
    );

  // Walk richest to leanest and take the first tier whose artwork lands in a
  // comfortable band. Deliberately measured against the scope-ON size at every
  // step: if the tier depended on the current scope state, toggling the scope
  // would change the deck's height and shift every control — the bug this whole
  // module exists to make impossible.
  let tier = TIERS[TIERS.length - 1];
  let deck = getDeckHeight(tier, fontScale);
  for (const candidate of TIERS) {
    const candidateDeck = getDeckHeight(candidate, fontScale);
    const inner =
      columnHeight - candidateDeck.height - candidate.stageInset * 2;
    const scopeBlock = candidate.scopeTopGap + scopeHeight + candidate.scopeBottomGap;
    const art = Math.min(inner - scopeBlock, artWidthCap(candidate));
    if (art >= (stacksAsTablet ? TABLET_ART_COMFORT_MIN : ART_COMFORT_MIN)) {
      tier = candidate;
      deck = candidateDeck;
      break;
    }
  }

  const stageHeight = Math.max(0, columnHeight - deck.height);
  // Clearance the artwork keeps from the header above and the deck below, so it
  // never crowds "PLAYING FROM" or the track title. The artwork is centred in
  // the stage, so budgeting for it on both sides is what actually reserves it.
  const stageInset = tier.stageInset;
  const innerStageHeight = Math.max(0, stageHeight - stageInset * 2);
  // On a window too short to hold both, the artwork wins and the rail is
  // dropped outright — reserving space it can't have would push the strip over
  // the deck. State-independent like everything else here, so the ∿ toggle
  // can't turn it back on and resize the stage.
  const naturalScopeBlock = tier.scopeTopGap + scopeHeight + tier.scopeBottomGap;
  const scopeRailFits = innerStageHeight - naturalScopeBlock >= SCOPE_RAIL_MIN_ART;
  const scopeBlockHeight = scopeRailFits ? naturalScopeBlock : 0;
  const widthCap = artWidthCap(tier);
  // Artwork takes the smaller of what the stage and the column allow. No floor:
  // on a window too small for even the compact tier the artwork shrinks rather
  // than spilling over the deck, because overflowing here would put the art on
  // top of the controls — the one thing this layout must never do.
  const fitArt = (verticalSpace: number) =>
    Math.round(Math.max(0, Math.min(verticalSpace, widthCap)));
  const artSizeScopeOn = fitArt(innerStageHeight - scopeBlockHeight);
  const artSizeScopeOff = fitArt(innerStageHeight);

  return {
    presentation: 'standard',
    isWide: false,
    density: tier.density,
    contentPadding,
    contentWidth,
    leftPaneWidth: contentWidth,
    rightPaneWidth: contentWidth,
    deck,
    stageHeight,
    stageInset,
    scopeBlockHeight,
    railBottomOffset: stageInset + tier.scopeBottomGap,
    scopeRailFits,
    artSize: showVisualizer ? artSizeScopeOn : artSizeScopeOff,
    artSizeScopeOn,
    artSizeScopeOff,
    scopeWidth,
    scopeHeight,
    visualizerTopGap: tier.scopeTopGap,
    visualizerBottomGap: tier.scopeBottomGap,
  };
}

/**
 * Additive tablet tier. Returning null means the caller must use the existing
 * single/wide layout unchanged.
 */
export function getTabletCompanionLayout(
  availableWidth: number,
  availableHeight: number,
  showVisualizer: boolean,
  fontScale = 1,
  companion: 'queue' | 'lyrics' = 'queue'
): TabletCompanionLayout | null {
  const shellWidth = Math.min(
    Math.max(0, availableWidth - CONTENT_SIDE_PADDING * 2),
    TABLET_SHELL_MAX_WIDTH
  );
  if (shellWidth < TABLET_SHELL_MIN_WIDTH) return null;

  const lyrics = companion === 'lyrics';
  // The player floor constrains lyrics only. Lyrics is the companion that asks
  // for a majority of the shell, so it is the only one that can starve the
  // player; the queue's 320-400 band never could, and applying the floor to it
  // as well squeezed the queue *below* its own minimum on a small tablet.
  const companionCeiling = lyrics
    ? Math.min(
        TABLET_COMPANION_LYRICS_MAX_WIDTH,
        Math.max(0, shellWidth - TABLET_COMPANION_GAP - TABLET_PLAYER_REGION_MIN)
      )
    : TABLET_COMPANION_MAX_WIDTH;
  const companionWidth = Math.round(
    Math.min(
      companionCeiling,
      Math.max(
        lyrics ? TABLET_COMPANION_LYRICS_MIN_WIDTH : TABLET_COMPANION_MIN_WIDTH,
        shellWidth * (lyrics ? TABLET_COMPANION_LYRICS_WIDTH_RATIO : TABLET_COMPANION_WIDTH_RATIO)
      )
    )
  );
  const playerRegionWidth = shellWidth - TABLET_COMPANION_GAP - companionWidth;
  // The player region always stacks now, so the old pair of gates — "tall
  // enough to stack (760)" *or* "wide enough to go side-by-side (600)" — asked
  // a question that no longer has two answers, and rejected the case they were
  // both written for: a 752dp-tall tablet whose player region the lyrics pane
  // had narrowed to 456. One gate, the same height bar the player itself uses.
  if (availableHeight < TABLET_STACK_MIN_HEIGHT) return null;
  return {
    presentation: 'tablet-companion',
    shellWidth,
    playerRegionWidth,
    companionWidth,
    gap: TABLET_COMPANION_GAP,
    playerLayout: getNowPlayingLayout(
      playerRegionWidth,
      availableHeight,
      showVisualizer,
      false,
      fontScale,
      // This tier only exists on a tablet, so the region keeps tablet sizing
      // however narrow the companion has made it.
      true
    ),
  };
}

/** Exposed for the layout test's tier-coverage assertions. */
export const NOW_PLAYING_DENSITY_TIERS = TIERS.map((tier) => tier.density);
export { ART_COMFORT_MIN as NOW_PLAYING_ART_COMFORT_MIN };

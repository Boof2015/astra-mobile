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
const WIDE_MAX_CONTENT_WIDTH = 960;
export const NOW_PLAYING_WIDE_PANE_GAP = spacing.xxl;
const WIDE_RIGHT_PANE_MIN = 300;
const WIDE_RIGHT_PANE_MAX = MAX_CONTENT_WIDTH;
const WIDE_ART_SIZE_MAX = 400;
const WIDE_ART_SIZE_MIN = 160;
const WIDE_COMPACT_HEIGHT = 480;
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
 * Artwork the scope rail must leave behind to be worth its stage space. Below
 * this the rail is dropped rather than squeezing the art into a thumbnail.
 */
const SCOPE_RAIL_MIN_ART = 96;

const TABLET_SHELL_MIN_WIDTH = 720;
const TABLET_SHELL_MAX_WIDTH = 1200;
const TABLET_COMPANION_GAP = spacing.xl;
const TABLET_COMPANION_MIN_WIDTH = 320;
const TABLET_COMPANION_MAX_WIDTH = 400;
const TABLET_STACKED_MIN_HEIGHT = 760;
const TABLET_WIDE_PLAYER_MIN_WIDTH = 600;
const TABLET_WIDE_MIN_HEIGHT = 520;

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
  fontScale = 1
): NowPlayingLayout {
  const isWide = forceWide || isWideWindow(availableWidth, availableHeight);

  if (isWide) {
    const contentPadding = CONTENT_SIDE_PADDING;
    const contentWidth = Math.max(
      0,
      Math.min(availableWidth - contentPadding * 2, WIDE_MAX_CONTENT_WIDTH)
    );
    const rightPaneWidth = Math.round(
      clamp(contentWidth * 0.46, WIDE_RIGHT_PANE_MIN, WIDE_RIGHT_PANE_MAX)
    );
    const leftPaneWidth = Math.max(
      0,
      contentWidth - NOW_PLAYING_WIDE_PANE_GAP - rightPaneWidth
    );
    const scopeWidth = Math.min(leftPaneWidth, VISUALIZER_WIDTH_MAX);
    const scopeHeight = getScopeHeight(scopeWidth);
    const visualizerTopGap = showVisualizer ? VISUALIZER_TOP_GAP : 0;
    const verticalBudget =
      availableHeight -
      NOW_PLAYING_CONTENT_TOP_PADDING -
      NOW_PLAYING_CONTENT_BOTTOM_PADDING -
      NOW_PLAYING_HEADER_HEIGHT -
      spacing.md;
    const wideArt = (budget: number) =>
      Math.round(clamp(Math.min(leftPaneWidth, budget), WIDE_ART_SIZE_MIN, WIDE_ART_SIZE_MAX));
    const artSizeScopeOn = wideArt(verticalBudget - (scopeHeight + VISUALIZER_TOP_GAP));
    const artSizeScopeOff = wideArt(verticalBudget);
    const artSize = showVisualizer ? artSizeScopeOn : artSizeScopeOff;
    // Short landscape windows get the leaner deck tokens.
    const deck = getDeckHeight(
      availableHeight < WIDE_COMPACT_HEIGHT ? TIERS[2] : TIERS[1],
      fontScale
    );
    return {
      presentation: 'wide',
      isWide: true,
      density: deck.density,
      contentPadding,
      contentWidth,
      leftPaneWidth,
      rightPaneWidth,
      deck,
      stageHeight: showVisualizer ? artSize + visualizerTopGap + scopeHeight : artSize,
      stageInset: 0,
      scopeBlockHeight: showVisualizer ? visualizerTopGap + scopeHeight : 0,
      railBottomOffset: 0,
      scopeRailFits: true,
      artSize,
      artSizeScopeOn,
      artSizeScopeOff,
      scopeWidth,
      scopeHeight,
      visualizerTopGap,
      visualizerBottomGap: 0,
    };
  }

  const isTabletColumn = availableWidth >= WIDE_MIN_WIDTH;
  const contentPadding = CONTENT_SIDE_PADDING;
  const maxContentWidth = isTabletColumn ? TABLET_MAX_CONTENT_WIDTH : MAX_CONTENT_WIDTH;
  const contentWidth = Math.max(
    0,
    Math.min(availableWidth - contentPadding * 2, maxContentWidth)
  );
  const scopeWidth = Math.max(
    0,
    Math.min(availableWidth - VISUALIZER_SIDE_PADDING * 2, VISUALIZER_WIDTH_MAX)
  );
  const scopeHeight = getScopeHeight(scopeWidth);
  const columnHeight =
    availableHeight -
    NOW_PLAYING_CONTENT_TOP_PADDING -
    NOW_PLAYING_CONTENT_BOTTOM_PADDING -
    NOW_PLAYING_HEADER_HEIGHT;

  const artWidthCap = (tier: DensityTier) =>
    Math.min(contentWidth, isTabletColumn ? TABLET_ART_SIZE_MAX : tier.artMax);

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
    if (art >= ART_COMFORT_MIN) {
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
  fontScale = 1
): TabletCompanionLayout | null {
  const shellWidth = Math.min(
    Math.max(0, availableWidth - CONTENT_SIDE_PADDING * 2),
    TABLET_SHELL_MAX_WIDTH
  );
  if (shellWidth < TABLET_SHELL_MIN_WIDTH) return null;

  const companionWidth = Math.round(
    clamp(shellWidth * 0.34, TABLET_COMPANION_MIN_WIDTH, TABLET_COMPANION_MAX_WIDTH)
  );
  const playerRegionWidth = shellWidth - TABLET_COMPANION_GAP - companionWidth;
  const canStack = availableHeight >= TABLET_STACKED_MIN_HEIGHT;
  const canUseWidePlayer =
    playerRegionWidth >= TABLET_WIDE_PLAYER_MIN_WIDTH &&
    availableHeight >= TABLET_WIDE_MIN_HEIGHT;
  if (!canStack && !canUseWidePlayer) return null;

  const forceWide = canUseWidePlayer && availableWidth > availableHeight;
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
      forceWide,
      fontScale
    ),
  };
}

/** Exposed for the layout test's tier-coverage assertions. */
export const NOW_PLAYING_DENSITY_TIERS = TIERS.map((tier) => tier.density);
export { ART_COMFORT_MIN as NOW_PLAYING_ART_COMFORT_MIN };

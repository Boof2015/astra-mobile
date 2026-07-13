import { spacing } from '../../theme/spacing.ts';
import { WIDE_MIN_WIDTH, isWideWindow } from '../../theme/adaptive.ts';

const MAX_CONTENT_WIDTH = 408;
const CONTENT_SIDE_PADDING = spacing.lg;
const NARROW_CONTENT_SIDE_PADDING = spacing.md;
const MEDIA_AREA_MIN = 220;
const TABLET_MAX_CONTENT_WIDTH = 520;
const TABLET_ART_SIZE_MAX = 440;
const PHONE_SCOPE_OFF_ART_SIZE_MAX = 336;
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
const VISUALIZER_BOTTOM_GAP = spacing.sm;
const VISUALIZER_HEIGHT_MIN = 84;
const VISUALIZER_HEIGHT_MAX = 108;
const VISUALIZER_HEIGHT_RATIO = 0.28;
export const NOW_PLAYING_HEADER_HEIGHT = 32;
export const NOW_PLAYING_CONTENT_TOP_PADDING = spacing.sm;
export const NOW_PLAYING_CONTENT_BOTTOM_PADDING = spacing.lg;
const MEDIA_TOP_MARGIN = spacing.lg;
const MEDIA_BOTTOM_GAP = spacing.xl;
const TRACK_INFO_ESTIMATE = 96;
export const NOW_PLAYING_WAVEFORM_HEIGHT = 58;
export const NOW_PLAYING_WAVEFORM_TOUCH_PADDING = spacing.md;
const WAVEFORM_BLOCK_ESTIMATE =
  NOW_PLAYING_WAVEFORM_HEIGHT + NOW_PLAYING_WAVEFORM_TOUCH_PADDING * 2 + 24;
export const NOW_PLAYING_PLAY_BUTTON_SIZE = 68;
const TRANSPORT_TOP_MARGIN = spacing.lg;
export const NOW_PLAYING_SUB_BUTTON_SIZE = 40;
const SUB_TOP_MARGIN = spacing.lg;
const MIN_FLOATING_SPACE = spacing.sm;

const TABLET_SHELL_MIN_WIDTH = 720;
const TABLET_SHELL_MAX_WIDTH = 1200;
const TABLET_COMPANION_GAP = spacing.xl;
const TABLET_COMPANION_MIN_WIDTH = 320;
const TABLET_COMPANION_MAX_WIDTH = 400;
const TABLET_STACKED_MIN_HEIGHT = 760;
const TABLET_WIDE_PLAYER_MIN_WIDTH = 600;
const TABLET_WIDE_MIN_HEIGHT = 520;

export type NowPlayingPresentation = 'standard' | 'wide';

export interface NowPlayingLayout {
  presentation: NowPlayingPresentation;
  isWide: boolean;
  contentPadding: number;
  contentWidth: number;
  leftPaneWidth: number;
  rightPaneWidth: number;
  controlsGap: number;
  trackInfoGap: number;
  waveformHeight: number;
  mediaStackHeight: number;
  artSize: number;
  scopeWidth: number;
  scopeHeight: number;
  visualizerTopGap: number;
  visualizerBottomGap: number;
  mediaTopMargin: number;
  mediaBottomGap: number;
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

function getScopeHeight(scopeWidth: number): number {
  return Math.round(
    clamp(scopeWidth * VISUALIZER_HEIGHT_RATIO, VISUALIZER_HEIGHT_MIN, VISUALIZER_HEIGHT_MAX)
  );
}

/**
 * Existing Now Playing layout calculator. Keep the numeric outputs stable for
 * phone, split-screen, foldable, and short-landscape windows.
 */
export function getNowPlayingLayout(
  availableWidth: number,
  availableHeight: number,
  showVisualizer: boolean,
  forceWide = false
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
    const artHeightBudget =
      verticalBudget - (showVisualizer ? scopeHeight + visualizerTopGap : 0);
    const artSize = Math.round(
      clamp(Math.min(leftPaneWidth, artHeightBudget), WIDE_ART_SIZE_MIN, WIDE_ART_SIZE_MAX)
    );
    const controlsGap = availableHeight < WIDE_COMPACT_HEIGHT ? spacing.sm : spacing.lg;
    return {
      presentation: 'wide',
      isWide: true,
      contentPadding,
      contentWidth,
      leftPaneWidth,
      rightPaneWidth,
      controlsGap,
      trackInfoGap: spacing.md,
      waveformHeight: NOW_PLAYING_WAVEFORM_HEIGHT,
      mediaStackHeight: showVisualizer
        ? artSize + visualizerTopGap + scopeHeight
        : artSize,
      artSize,
      scopeWidth,
      scopeHeight,
      visualizerTopGap,
      visualizerBottomGap: 0,
      mediaTopMargin: 0,
      mediaBottomGap: 0,
    };
  }

  const isTabletColumn = availableWidth >= WIDE_MIN_WIDTH;
  const contentPadding =
    availableWidth < 360 ? NARROW_CONTENT_SIDE_PADDING : CONTENT_SIDE_PADDING;
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
  const mediaMax = Math.min(
    contentWidth,
    isTabletColumn ? TABLET_ART_SIZE_MAX : contentWidth
  );
  const mediaMin = Math.min(mediaMax, MEDIA_AREA_MIN);
  const mediaTopMargin = availableHeight < 680 ? spacing.md : MEDIA_TOP_MARGIN;
  const mediaBottomGap = availableHeight < 680 ? spacing.lg : MEDIA_BOTTOM_GAP;
  const fixedHeightBase =
    NOW_PLAYING_CONTENT_TOP_PADDING +
    NOW_PLAYING_CONTENT_BOTTOM_PADDING +
    NOW_PLAYING_HEADER_HEIGHT +
    mediaTopMargin +
    TRACK_INFO_ESTIMATE +
    WAVEFORM_BLOCK_ESTIMATE +
    TRANSPORT_TOP_MARGIN +
    NOW_PLAYING_PLAY_BUTTON_SIZE +
    SUB_TOP_MARGIN +
    NOW_PLAYING_SUB_BUTTON_SIZE +
    MIN_FLOATING_SPACE;
  const bound = availableHeight - fixedHeightBase - mediaBottomGap;
  const uncappedScopeOffArt = Math.round(
    clamp(bound, Math.min(mediaMin, Math.max(96, bound)), mediaMax)
  );
  const scopeOffArt = isTabletColumn
    ? uncappedScopeOffArt
    : Math.min(uncappedScopeOffArt, PHONE_SCOPE_OFF_ART_SIZE_MAX);
  const offSurplus = Math.max(0, bound - uncappedScopeOffArt);
  const stretchUnit = Math.min(Math.floor(offSurplus / 5), spacing.md);
  const waveformHeight = NOW_PLAYING_WAVEFORM_HEIGHT + stretchUnit * 2;
  const scopeBlockHeight = VISUALIZER_TOP_GAP + scopeHeight + VISUALIZER_BOTTOM_GAP;
  // Keep the old stage height even when the visualizer-off artwork is capped.
  // This preserves the metadata/lower-content anchor across the toggle.
  const mediaStackHeight = Math.max(uncappedScopeOffArt, 96 + scopeBlockHeight);
  const scopeOnArt = mediaStackHeight - scopeBlockHeight;
  const artSize = showVisualizer ? scopeOnArt : scopeOffArt;
  const visualizerTopGap = showVisualizer ? VISUALIZER_TOP_GAP : 0;
  const visualizerBottomGap = showVisualizer ? VISUALIZER_BOTTOM_GAP : 0;

  return {
    presentation: 'standard',
    isWide: false,
    contentPadding,
    contentWidth,
    leftPaneWidth: contentWidth,
    rightPaneWidth: contentWidth,
    controlsGap: TRANSPORT_TOP_MARGIN,
    trackInfoGap: spacing.md,
    waveformHeight,
    mediaStackHeight,
    artSize,
    scopeWidth,
    scopeHeight,
    visualizerTopGap,
    visualizerBottomGap,
    mediaTopMargin,
    mediaBottomGap,
  };
}

/**
 * Additive tablet tier. Returning null means the caller must use the existing
 * single/wide layout unchanged.
 */
export function getTabletCompanionLayout(
  availableWidth: number,
  availableHeight: number,
  showVisualizer: boolean
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
      forceWide
    ),
  };
}

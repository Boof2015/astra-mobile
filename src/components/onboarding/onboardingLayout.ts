import { MAX_FONT_SCALE, fontSize, variantLineHeight } from '../../theme/typography.ts';
import { WIDE_MIN_WIDTH } from '../../theme/adaptive.ts';

/**
 * Wizard geometry. Rigid deck + one elastic region: the chrome, the title block
 * and the footer are sums of declared constants, and the content region between
 * them takes whatever is left (Yoga sizes it, never a subtraction here). So the
 * title and the footer button sit at the same place on every page of a device,
 * whatever each page puts in its content.
 *
 * Two presentations:
 * - **stack**: a phone in portrait. Chrome, title, content, footer top to bottom.
 * - **split**: the title column beside the content column. Picked when the
 *   shell itself would switch to its rail (a short window, i.e. a phone on its
 *   side) or when the window is tablet-wide. Same pieces, same order.
 */

export const ONBOARDING_GUTTER = 16;
/** Back button + progress bar. */
export const ONBOARDING_CHROME_HEIGHT = 56;
/** Gap between the chrome and the eyebrow. */
export const ONBOARDING_TITLE_TOP = 12;
export const ONBOARDING_FOOTER_BUTTON = 52;
export const ONBOARDING_FOOTER_TOP = 16;
export const ONBOARDING_FOOTER_BOTTOM = 12;

const EYEBROW_TO_TITLE = 8;
const TITLE_TO_SUBTITLE = 8;
const TITLE_BLOCK_BOTTOM = 16;
export const ONBOARDING_TITLE_LINES = 2;
export const ONBOARDING_SUBTITLE_LINES = 3;
const EYEBROW_SIZE = 11;
const EYEBROW_LINE = 16;

/** Left column share in split presentation. A ratio, never a capped width. */
const SPLIT_TITLE_SHARE = 0.4;

export interface OnboardingInsets {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

export interface OnboardingType {
  /** Font sizes and line boxes, already scaled; render with allowFontScaling off. */
  eyebrow: { fontSize: number; lineHeight: number };
  title: { fontSize: number; lineHeight: number };
  subtitle: { fontSize: number; lineHeight: number };
}

export interface OnboardingLayout {
  presentation: 'stack' | 'split';
  type: OnboardingType;
  /** Eyebrow + title (2 lines) + subtitle (3 lines) + spacing, in dp. */
  titleBlockHeight: number;
  footerHeight: number;
  /** Width of the title column in split; the full content width in stack. */
  titleColumnWidth: number;
  /** Width of the content column (cards, rows, form). */
  contentColumnWidth: number;
  /** Bookend hero offsets from the top of the area below the status bar. */
  welcomeHeroTop: number;
  doneHeroTop: number;
  /** Side length of the cropped mark graphic behind the bookends. */
  markGraphicSize: number;
}

/**
 * Font scale as the line boxes will really render it. Android caps fontSize at
 * `maxFontSizeMultiplier` but not lineHeight, so the wizard sizes its title text
 * itself (allowFontScaling off), exactly like ScreenHeader.
 */
export function onboardingTextScale(fontScale: number): number {
  return Math.min(Math.max(fontScale, 1), MAX_FONT_SCALE);
}

export function getOnboardingLayout(
  width: number,
  height: number,
  insets: OnboardingInsets,
  fontScale: number,
  /** From `getShellLayout(...).mode === 'rail'`, so the wizard and the shell agree on "short". */
  shortWindow: boolean
): OnboardingLayout {
  const scale = onboardingTextScale(fontScale);
  const type: OnboardingType = {
    eyebrow: { fontSize: EYEBROW_SIZE * scale, lineHeight: Math.ceil(EYEBROW_LINE * scale) },
    title: { fontSize: fontSize.xxl * scale, lineHeight: Math.ceil(variantLineHeight.title * scale) },
    subtitle: { fontSize: fontSize.base * scale, lineHeight: Math.ceil(variantLineHeight.body * scale) },
  };
  const titleBlockHeight =
    ONBOARDING_TITLE_TOP +
    type.eyebrow.lineHeight +
    EYEBROW_TO_TITLE +
    type.title.lineHeight * ONBOARDING_TITLE_LINES +
    TITLE_TO_SUBTITLE +
    type.subtitle.lineHeight * ONBOARDING_SUBTITLE_LINES +
    TITLE_BLOCK_BOTTOM;
  const footerHeight = ONBOARDING_FOOTER_TOP + ONBOARDING_FOOTER_BUTTON + ONBOARDING_FOOTER_BOTTOM;

  const innerWidth = Math.max(0, width - insets.left - insets.right);
  const innerHeight = Math.max(0, height - insets.top - insets.bottom);
  const presentation = shortWindow || innerWidth >= WIDE_MIN_WIDTH ? 'split' : 'stack';
  const titleColumnWidth =
    presentation === 'split' ? Math.round(innerWidth * SPLIT_TITLE_SHARE) : innerWidth;
  const contentColumnWidth = presentation === 'split' ? innerWidth - titleColumnWidth : innerWidth;

  return {
    presentation,
    type,
    titleBlockHeight,
    footerHeight,
    titleColumnWidth,
    contentColumnWidth,
    // A computed number may place a hero; it never moves a control (the footer
    // is the only control on a bookend and it is rigid).
    welcomeHeroTop: Math.round(innerHeight * (presentation === 'split' ? 0.18 : 0.275)),
    doneHeroTop: Math.round(innerHeight * (presentation === 'split' ? 0.12 : 0.165)),
    markGraphicSize: Math.round(2.19 * Math.min(width, height)),
  };
}

import { MAX_FONT_SCALE } from '../../theme/typography.ts';
import { RAIL_LETTERS } from '../../lib/letterIndex.ts';

export const ALPHABET_LETTER_LINE_HEIGHT = 17;
const RAIL_PADDING = 4;

export interface AlphabetRailLayout {
  height: number;
  labelHeight: number;
  firstCenter: number;
  step: number;
  labelIndices: number[];
}

/** Fit the whole scrub range, reducing visible labels before shrinking text. */
export function getAlphabetRailLayout(
  availableHeight: number,
  fontScale = 1,
): AlphabetRailLayout | null {
  const scale = Math.max(1, Math.min(MAX_FONT_SCALE, fontScale));
  const labelHeight = Math.ceil(ALPHABET_LETTER_LINE_HEIGHT * scale);
  if (!Number.isFinite(availableHeight) || availableHeight < labelHeight * 2 + RAIL_PADDING * 2) {
    return null;
  }
  const lastIndex = RAIL_LETTERS.length - 1;
  const height = Math.min(availableHeight, labelHeight * RAIL_LETTERS.length + RAIL_PADDING * 2);
  const step = (height - RAIL_PADDING * 2 - labelHeight) / lastIndex;
  const stride = Math.ceil(labelHeight / step);
  const intervals = Math.max(1, Math.floor(lastIndex / stride));
  const labelIndices = Array.from(
    { length: intervals + 1 },
    (_, index) => Math.round(index * lastIndex / intervals),
  );
  return {
    height,
    labelHeight,
    firstCenter: RAIL_PADDING + labelHeight / 2,
    step,
    labelIndices,
  };
}

/** Every letter keeps a scrub interval, including those drawn as dots. */
export function alphabetRailIndexAt(y: number, layout: AlphabetRailLayout): number {
  'worklet';
  return Math.max(
    0,
    Math.min(
      RAIL_LETTERS.length - 1,
      Math.round((y - layout.firstCenter) / layout.step),
    ),
  );
}

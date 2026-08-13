export type AppPressFeedback = 'surface' | 'tile' | 'control' | 'accent' | 'none';

export interface PressFeedbackDecision {
  overlay: 'behind' | 'above' | null;
  opacity: number | null;
}

export interface FeedbackCornerSource {
  borderRadius?: number;
  borderTopLeftRadius?: number;
  borderTopRightRadius?: number;
  borderBottomLeftRadius?: number;
  borderBottomRightRadius?: number;
}

export interface FeedbackCorners {
  borderTopLeftRadius?: number;
  borderTopRightRadius?: number;
  borderBottomLeftRadius?: number;
  borderBottomRightRadius?: number;
}

const IDLE_FEEDBACK: PressFeedbackDecision = { overlay: null, opacity: null };

export function resolvePressFeedback(
  feedback: AppPressFeedback,
  pressed: boolean,
  disabled: boolean,
): PressFeedbackDecision {
  if (!pressed || disabled || feedback === 'none') return IDLE_FEEDBACK;
  if (feedback === 'surface') return { overlay: 'behind', opacity: null };
  if (feedback === 'tile') return { overlay: 'above', opacity: null };
  if (feedback === 'control') return { overlay: null, opacity: 0.74 };
  return { overlay: null, opacity: 0.88 };
}

export function resolveFeedbackCorners(
  style: FeedbackCornerSource | undefined,
  override?: number,
): FeedbackCorners {
  const fallback = override ?? style?.borderRadius;
  return {
    borderTopLeftRadius: override ?? style?.borderTopLeftRadius ?? fallback,
    borderTopRightRadius: override ?? style?.borderTopRightRadius ?? fallback,
    borderBottomLeftRadius: override ?? style?.borderBottomLeftRadius ?? fallback,
    borderBottomRightRadius: override ?? style?.borderBottomRightRadius ?? fallback,
  };
}

export function composePressedStyle<T>(
  style: T,
  decision: PressFeedbackDecision,
): T | [T, { opacity: number }] {
  return decision.opacity == null ? style : [style, { opacity: decision.opacity }];
}

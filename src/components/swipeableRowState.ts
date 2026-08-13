export type SwipeLaneSide = 'left' | 'right';

export const SWIPE_ACTIVE_OFFSET_X = 10;
// Scroll-slop-sized: at 30 every vertical drag starting on a row had to travel
// 30px before the pan failed and the surrounding scrollable could win. Keep
// this tighter than the horizontal activation threshold so vertical intent
// yields immediately.
export const SWIPE_FAIL_OFFSET_Y = 6;

/**
 * Action lanes sit underneath an opaque row and should only exist visually
 * while that row is moving toward them. Keeping them opaque at rest lets a
 * parent scene-opacity animation reveal both half-width lane colors through the
 * row on Android.
 */
export function swipeLaneOpacity(
  translationX: number,
  side: SwipeLaneSide
): number {
  'worklet';
  if (!Number.isFinite(translationX)) return 0;
  return side === 'left'
    ? translationX > 1 ? 1 : 0
    : translationX < -1 ? 1 : 0;
}

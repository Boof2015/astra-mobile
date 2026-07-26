export type SwipeLaneSide = 'left' | 'right';

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

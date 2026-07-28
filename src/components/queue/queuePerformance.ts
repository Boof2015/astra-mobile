export const QUEUE_ROW_HEIGHT = 64;
export const QUEUE_INITIAL_RENDER_AHEAD_ROWS = 4;
export const QUEUE_INITIAL_RENDER_DISTANCE =
  QUEUE_ROW_HEIGHT * QUEUE_INITIAL_RENDER_AHEAD_ROWS;
export const QUEUE_RENDER_AHEAD_MIN_ROWS = 12;
export const QUEUE_RENDER_WINDOW_MULTIPLIER = 2;

const QUEUE_SHEET_INITIAL_FRACTION = 0.58;
const QUEUE_PREVIEW_NON_LIST_HEIGHT = 220;
const QUEUE_PREVIEW_MAX_ROWS = 6;

/**
 * The preview only fills the list portion of the initial sheet snap. Using the
 * whole window height used to duplicate far more rows than could be visible
 * while FlashList was mounting its own render-ahead window underneath.
 */
export function queuePreviewRowCount(windowHeight: number): number {
  const initialListHeight = Math.max(
    QUEUE_ROW_HEIGHT,
    windowHeight * QUEUE_SHEET_INITIAL_FRACTION - QUEUE_PREVIEW_NON_LIST_HEIGHT
  );
  return Math.min(
    QUEUE_PREVIEW_MAX_ROWS,
    Math.max(1, Math.ceil(initialListHeight / QUEUE_ROW_HEIGHT))
  );
}

export function queueRenderDistance(windowHeight: number): number {
  const safeWindowHeight = Number.isFinite(windowHeight)
    ? Math.max(0, windowHeight)
    : 0;
  return Math.max(
    QUEUE_ROW_HEIGHT * QUEUE_RENDER_AHEAD_MIN_ROWS,
    Math.ceil(safeWindowHeight * QUEUE_RENDER_WINDOW_MULTIPLIER),
  );
}

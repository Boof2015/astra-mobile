/**
 * RNTP is a bounded transport, never the source of truth for a library queue.
 * Room owns complete order while these helpers keep local indices stable.
 */
export const VIRTUAL_PLAYBACK_HISTORY = 8;
export const VIRTUAL_PLAYBACK_UPCOMING = 32;
export const VIRTUAL_PLAYBACK_WINDOW_SIZE =
  VIRTUAL_PLAYBACK_HISTORY + 1 + VIRTUAL_PLAYBACK_UPCOMING;
export const VIRTUAL_PLAYBACK_REFILL_THRESHOLD = 16;
export const VIRTUAL_PLAYBACK_APPEND_BATCH = 8;

export function virtualPlaybackWindowStart(activePosition: number): number {
  return Math.max(0, Math.floor(activePosition) - VIRTUAL_PLAYBACK_HISTORY);
}

export function virtualPlaybackTrimCount(activeLocalIndex: number): number {
  return Math.max(0, Math.floor(activeLocalIndex) - VIRTUAL_PLAYBACK_HISTORY);
}

export function shouldRefillVirtualPlayback(
  upcomingCount: number,
  loadedEnd: number,
  totalCount: number,
): boolean {
  return upcomingCount < VIRTUAL_PLAYBACK_REFILL_THRESHOLD && loadedEnd < totalCount;
}

export function virtualPlaybackRefillLimit(
  upcomingCount: number,
  loadedEnd: number,
  totalCount: number,
): number {
  return Math.max(
    0,
    Math.min(
      VIRTUAL_PLAYBACK_UPCOMING - Math.max(0, upcomingCount),
      totalCount - loadedEnd,
    ),
  );
}

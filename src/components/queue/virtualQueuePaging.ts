export const VIRTUAL_QUEUE_PAGE_SIZE = 250;
export const VIRTUAL_QUEUE_PREFETCH_ROWS = 100;

interface VirtualPositionedTrack {
  astraQueuePosition?: unknown;
}

export function virtualQueuePosition(track: unknown): number | null {
  const position = (track as VirtualPositionedTrack | null)?.astraQueuePosition;
  return typeof position === 'number' && Number.isFinite(position) && position >= 0
    ? position
    : null;
}

/**
 * Keeps every page loaded during the current tray session. Existing rows win
 * at duplicate page boundaries so memoized queue rows retain their identity.
 */
export function mergeVirtualQueueTracks<T>(
  existing: readonly T[],
  incoming: readonly T[],
): T[] {
  const tracksByPosition = new Map<number, T>();

  existing.forEach((track) => {
    const position = virtualQueuePosition(track);
    if (position !== null) tracksByPosition.set(position, track);
  });
  incoming.forEach((track) => {
    const position = virtualQueuePosition(track);
    if (position !== null && !tracksByPosition.has(position)) {
      tracksByPosition.set(position, track);
    }
  });

  return [...tracksByPosition.entries()]
    .sort(([left], [right]) => left - right)
    .map(([, track]) => track);
}

export function seedVirtualQueueTracks<T>(
  playbackWindow: readonly T[],
  activePosition: number,
  totalCount: number,
): T[] {
  return mergeVirtualQueueTracks(
    [],
    playbackWindow.filter((track) => {
      const position = virtualQueuePosition(track);
      return position !== null && position > activePosition && position < totalCount;
    }),
  );
}

export function nextVirtualQueuePageStart(
  tracks: readonly unknown[],
  activePosition: number,
  totalCount: number,
): number | null {
  const lastPosition = tracks.length > 0
    ? virtualQueuePosition(tracks[tracks.length - 1])
    : null;
  const start = (lastPosition ?? activePosition) + 1;
  return start < totalCount ? start : null;
}

/**
 * Break the empty-list mount deadlock: when the playback window has no usable
 * upcoming rows but the virtual context still has tracks, paging cannot wait
 * for FlashList's first paint because an empty list may never report one.
 */
export function isVirtualQueueWaitingForTracks(
  visibleTrackCount: number,
  activePosition: number,
  totalCount: number,
): boolean {
  return (
    visibleTrackCount === 0
    && nextVirtualQueuePageStart([], activePosition, totalCount) !== null
  );
}

export function shouldPrefetchVirtualQueue(
  lastVisibleIndex: number,
  loadedCount: number,
  hasMore: boolean,
  prefetchRows = VIRTUAL_QUEUE_PREFETCH_ROWS,
): boolean {
  if (!hasMore || loadedCount <= 0 || lastVisibleIndex < 0) return false;
  return lastVisibleIndex >= Math.max(0, loadedCount - prefetchRows);
}

export function isCurrentVirtualQueueRequest(
  requestGeneration: number,
  currentGeneration: number,
  requestSessionId: string,
  currentSessionId: string | undefined,
): boolean {
  return (
    requestGeneration === currentGeneration &&
    requestSessionId === currentSessionId
  );
}

export type LibraryViewMode = 'albums' | 'artists' | 'tracks' | 'playlists' | 'folders';
export type LibraryViewModeDirection = -1 | 0 | 1;

export const LIBRARY_VIEW_MODES: readonly {
  key: LibraryViewMode;
  label: string;
}[] = [
  { key: 'albums', label: 'Albums' },
  { key: 'artists', label: 'Artists' },
  { key: 'tracks', label: 'Tracks' },
  { key: 'playlists', label: 'Playlists' },
  { key: 'folders', label: 'Folders' },
];

export function libraryViewModeLabel(mode: LibraryViewMode): string {
  return LIBRARY_VIEW_MODES.find((entry) => entry.key === mode)?.label ?? mode;
}

export function adjacentLibraryViewMode(
  mode: LibraryViewMode,
  direction: -1 | 1
): LibraryViewMode | undefined {
  const index = LIBRARY_VIEW_MODES.findIndex((entry) => entry.key === mode);
  return LIBRARY_VIEW_MODES[index + direction]?.key;
}

export function libraryViewModeDirection(
  from: LibraryViewMode,
  to: LibraryViewMode
): LibraryViewModeDirection {
  const fromIndex = LIBRARY_VIEW_MODES.findIndex((entry) => entry.key === from);
  const toIndex = LIBRARY_VIEW_MODES.findIndex((entry) => entry.key === to);
  return toIndex === fromIndex ? 0 : toIndex > fromIndex ? 1 : -1;
}

export interface LibraryViewModeTransitionRequest {
  mode: LibraryViewMode;
  direction: LibraryViewModeDirection;
  animated: boolean;
}

/**
 * Resolves every request from the surface that is actually mounted. Callers
 * keep only the latest result, so repeated taps during an exit naturally
 * collapse to the newest destination instead of building a transition queue.
 */
export function resolveLibraryViewModeTransition(
  displayedMode: LibraryViewMode,
  requestedMode: LibraryViewMode,
  reducedMotion: boolean
): LibraryViewModeTransitionRequest {
  const direction = libraryViewModeDirection(displayedMode, requestedMode);
  return {
    mode: requestedMode,
    direction,
    animated: !reducedMotion && direction !== 0,
  };
}

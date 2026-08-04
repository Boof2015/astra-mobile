export type LibraryViewMode = 'albums' | 'artists' | 'tracks' | 'playlists' | 'folders';

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

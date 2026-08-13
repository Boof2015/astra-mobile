export interface FolderBrowserNodeState<TNode, TTrack> {
  node: TNode;
  childIds: readonly string[];
  tracks: readonly TTrack[];
  nextOffset: number | null;
}

export type FolderBrowserRow<TNode, TTrack> =
  | { type: 'up'; id: 'folder-browser:up' }
  | { type: 'folder'; id: string; node: TNode }
  | { type: 'track'; id: string; track: TTrack }
  | { type: 'more'; id: string; nodeId: string };

export function currentFolderId(path: readonly string[]): string | null {
  return path[path.length - 1] ?? null;
}

export function enterFolder(
  path: readonly string[],
  nodeId: string,
): string[] {
  return [...path, nodeId];
}

/** Returns null at the browser root so hardware Back can fall through. */
export function leaveFolder(path: readonly string[]): string[] | null {
  if (path.length === 0) return null;
  return path.slice(0, -1);
}

/**
 * One directory at a time: parent entry, child folders, direct tracks, pager.
 * The root contains only the configured library roots and has no parent row.
 */
export function folderBrowserRows<TNode, TTrack>({
  path,
  rootIds,
  nodes,
  trackId,
}: {
  path: readonly string[];
  rootIds: readonly string[];
  nodes: ReadonlyMap<string, FolderBrowserNodeState<TNode, TTrack>>;
  trackId: (track: TTrack) => string;
}): FolderBrowserRow<TNode, TTrack>[] {
  const currentId = currentFolderId(path);
  if (currentId == null) {
    return rootIds.flatMap((id) => {
      const state = nodes.get(id);
      return state ? [{ type: 'folder' as const, id, node: state.node }] : [];
    });
  }

  const current = nodes.get(currentId);
  if (!current) return [];

  const rows: FolderBrowserRow<TNode, TTrack>[] = [
    { type: 'up', id: 'folder-browser:up' },
  ];
  for (const childId of current.childIds) {
    const child = nodes.get(childId);
    if (child) rows.push({ type: 'folder', id: childId, node: child.node });
  }
  for (const track of current.tracks) {
    rows.push({
      type: 'track',
      id: `folder-browser:track:${currentId}:${trackId(track)}`,
      track,
    });
  }
  if (current.nextOffset != null) {
    rows.push({
      type: 'more',
      id: `folder-browser:more:${currentId}:${current.nextOffset}`,
      nodeId: currentId,
    });
  }
  return rows;
}

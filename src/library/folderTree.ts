import type { DbTrack, LibraryFolder } from '@/types/library';

export interface FolderTreeSourceFolder extends LibraryFolder {
  track_count?: number;
}

export interface FolderTreeNode {
  id: string;
  name: string;
  fullPath: string;
  depth: number;
  available: boolean;
  children: FolderTreeNode[];
  tracks: DbTrack[];
  subtreeTracks: DbTrack[];
  totalTrackCount: number;
}

export type FlattenedFolderTreeRow =
  | {
      type: 'folder';
      id: string;
      node: FolderTreeNode;
      depth: number;
      isExpanded: boolean;
      canExpand: boolean;
    }
  | {
      type: 'track';
      id: string;
      track: DbTrack;
      folderTracks: DbTrack[];
      folderName: string;
      depth: number;
    };

function decodedSafPathFromUri(uri: string, marker: '/tree/' | '/document/'): string | null {
  const idx = uri.indexOf(marker);
  if (idx < 0) return null;

  let docId: string;
  try {
    docId = decodeURIComponent(uri.slice(idx + marker.length));
  } catch {
    return null;
  }

  const colon = docId.indexOf(':');
  return colon >= 0 ? docId.slice(colon + 1) : docId;
}

/** "content://.../tree/primary%3AMusic%2FAstraTest" -> "Music/AstraTest" */
export function decodedSafTreePath(treeUri: string): string | null {
  return decodedSafPathFromUri(treeUri, '/tree/');
}

/** "content://.../document/primary%3AMusic%2FA%2Ff.flac" -> "Music/A/f.flac" */
export function decodedSafDocumentPath(documentUri: string): string | null {
  return decodedSafPathFromUri(documentUri, '/document/');
}

function compareNames(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
}

function compareTracksByPath(a: DbTrack, b: DbTrack): number {
  const aPath = decodedSafDocumentPath(a.path) ?? a.path;
  const bPath = decodedSafDocumentPath(b.path) ?? b.path;
  return compareNames(aPath, bPath);
}

function relativeTrackPath(folderRootPath: string | null, track: DbTrack): string {
  const docPath = decodedSafDocumentPath(track.path);
  if (!docPath) return track.file_name;

  if (!folderRootPath) return docPath;
  if (docPath === folderRootPath) return track.file_name;
  if (docPath.startsWith(`${folderRootPath}/`)) return docPath.slice(folderRootPath.length + 1);

  return track.file_name;
}

function makeNode({
  id,
  name,
  fullPath,
  depth,
  available,
}: {
  id: string;
  name: string;
  fullPath: string;
  depth: number;
  available: boolean;
}): FolderTreeNode {
  return {
    id,
    name,
    fullPath,
    depth,
    available,
    children: [],
    tracks: [],
    subtreeTracks: [],
    totalTrackCount: 0,
  };
}

function finalizeNode(node: FolderTreeNode): number {
  node.children.sort((a, b) => compareNames(a.name, b.name));
  node.tracks.sort(compareTracksByPath);

  const subtreeTracks: DbTrack[] = [];
  let totalTrackCount = node.tracks.length;

  for (const child of node.children) {
    totalTrackCount += finalizeNode(child);
    subtreeTracks.push(...child.subtreeTracks);
  }

  subtreeTracks.push(...node.tracks);
  node.subtreeTracks = subtreeTracks;
  node.totalTrackCount = totalTrackCount;
  return totalTrackCount;
}

export function buildFolderTree(
  folders: readonly FolderTreeSourceFolder[],
  tracks: readonly DbTrack[]
): FolderTreeNode[] {
  const foldersById = new Map(folders.map((folder) => [folder.id, folder]));
  const tracksByFolderId = new Map<number, DbTrack[]>();

  for (const track of tracks) {
    if (track.source_type !== 'local' || track.folder_id == null) continue;
    if (!foldersById.has(track.folder_id)) continue;

    const folderTracks = tracksByFolderId.get(track.folder_id);
    if (folderTracks) {
      folderTracks.push(track);
    } else {
      tracksByFolderId.set(track.folder_id, [track]);
    }
  }

  const roots: FolderTreeNode[] = [];

  for (const folder of folders) {
    const folderTracks = tracksByFolderId.get(folder.id) ?? [];
    if (folderTracks.length === 0) continue;

    const rootPath = decodedSafTreePath(folder.tree_uri);
    const rootFullPath = rootPath || folder.display_name;
    const root = makeNode({
      id: `folder:${folder.id}`,
      name: folder.display_name,
      fullPath: rootFullPath,
      depth: 0,
      available: folder.available,
    });
    const childrenByPath = new Map<string, FolderTreeNode>();

    for (const track of folderTracks) {
      const relativePath = relativeTrackPath(rootPath, track);
      const segments = relativePath.split('/').filter(Boolean);
      segments.pop();

      let current = root;
      let pathSoFar = rootFullPath;

      for (const segment of segments) {
        pathSoFar = pathSoFar ? `${pathSoFar}/${segment}` : segment;
        const id = `folder:${folder.id}:${pathSoFar}`;
        let child = childrenByPath.get(id);
        if (!child) {
          child = makeNode({
            id,
            name: segment,
            fullPath: pathSoFar,
            depth: current.depth + 1,
            available: folder.available,
          });
          childrenByPath.set(id, child);
          current.children.push(child);
        }
        current = child;
      }

      current.tracks.push(track);
    }

    finalizeNode(root);
    roots.push(root);
  }

  return roots.sort((a, b) => compareNames(a.name, b.name));
}

export function flattenFolderTree(
  tree: readonly FolderTreeNode[],
  expandedNodeIds: ReadonlySet<string>
): FlattenedFolderTreeRow[] {
  const rows: FlattenedFolderTreeRow[] = [];

  const visit = (node: FolderTreeNode) => {
    const canExpand = node.children.length > 0 || node.tracks.length > 0;
    const isExpanded = expandedNodeIds.has(node.id);

    rows.push({
      type: 'folder',
      id: node.id,
      node,
      depth: node.depth,
      isExpanded,
      canExpand,
    });

    if (!isExpanded) return;

    for (const child of node.children) {
      visit(child);
    }

    for (const track of node.tracks) {
      rows.push({
        type: 'track',
        id: `track:${track.id}`,
        track,
        folderTracks: node.tracks,
        folderName: node.name,
        depth: node.depth + 1,
      });
    }
  };

  for (const root of tree) {
    visit(root);
  }

  return rows;
}

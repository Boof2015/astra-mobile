// Scan orchestration: SAF folder pick -> native walk -> diff against DB ->
// native metadata extraction in batches -> batched upserts. Concepts (mtime
// skip, batching, never-abort-on-file-errors) ported from desktop scanFolder.

import { StorageAccessFramework } from 'expo-file-system/legacy';
import { AstraLibraryScanner, type ScannedFile } from '../../modules/astra-library-scanner';
import { openLibraryDb } from '@/db/database';
import {
  deleteFolder,
  deleteTracksByPaths,
  getFolders,
  getFolderSyncRows,
  getFolderTrackCounts,
  insertFolder,
  markFolderScanned,
  upsertTracks,
  type TrackUpsert,
} from '@/db/queries';
import type { LibraryFolder } from '@/types/library';
import { AUDIO_EXTENSIONS } from './audioExtensions';
import { metadataToUpsertRow } from './trackAdapter';

const EXTRACT_BATCH_SIZE = 24;

export interface ScanProgress {
  phase: 'discovering' | 'extracting';
  processed: number;
  total: number;
  folderName: string;
}

export interface ScanCallbacks {
  onProgress?: (progress: ScanProgress) => void;
}

export interface ScanResult {
  added: number;
  updated: number;
  removed: number;
  errors: number;
}

function emptyResult(): ScanResult {
  return { added: 0, updated: 0, removed: 0, errors: 0 };
}

/** "content://…/tree/primary%3AMusic%2FAstraTest" -> "AstraTest" */
function displayNameFromTreeUri(treeUri: string): string {
  const lastSegment = treeUri.split('/').pop() ?? treeUri;
  const decoded = decodeURIComponent(lastSegment);
  const name = decoded.split(/[/:]/).pop()?.trim();
  return name || 'Music folder';
}

/** Folder rows joined with current permission state and track counts. */
export async function loadFolders(): Promise<(LibraryFolder & { track_count: number })[]> {
  const db = await openLibraryDb();
  const [rows, counts] = await Promise.all([getFolders(db), getFolderTrackCounts(db)]);
  const persisted = new Set(AstraLibraryScanner.getPersistedTreeUris());
  return rows.map((row) => ({
    ...row,
    available: persisted.has(row.tree_uri),
    track_count: counts.get(row.id) ?? 0,
  }));
}

/**
 * System folder picker -> persist grant -> folder row -> scan.
 * Returns null if the user cancelled the picker.
 */
export async function addFolderViaPicker(callbacks?: ScanCallbacks): Promise<ScanResult | null> {
  const permission = await StorageAccessFramework.requestDirectoryPermissionsAsync();
  if (!permission.granted) return null;

  const treeUri = permission.directoryUri;
  await AstraLibraryScanner.takePersistableUriPermission(treeUri);

  const db = await openLibraryDb();
  const row = await insertFolder(db, treeUri, displayNameFromTreeUri(treeUri));
  return scanFolder({ ...row, available: true }, { callbacks });
}

export async function scanFolder(
  folder: Omit<LibraryFolder, 'available'> & { available?: boolean },
  opts: { mode?: 'incremental' | 'full'; callbacks?: ScanCallbacks } = {}
): Promise<ScanResult> {
  const { mode = 'incremental', callbacks } = opts;
  const db = await openLibraryDb();
  const result = emptyResult();

  // Native discovery runs as one promise; forward its progress events.
  const subscription = AstraLibraryScanner.addListener('onScanProgress', (event) => {
    callbacks?.onProgress?.({
      phase: 'discovering',
      processed: 0,
      total: event.found,
      folderName: folder.display_name,
    });
  });
  callbacks?.onProgress?.({ phase: 'discovering', processed: 0, total: 0, folderName: folder.display_name });

  let files: ScannedFile[];
  let covers: Record<string, string>;
  try {
    const listing = await AstraLibraryScanner.listAudioFiles(folder.tree_uri, AUDIO_EXTENSIONS);
    files = listing.files;
    covers = listing.covers;
  } finally {
    subscription.remove();
  }

  // Diff against what the DB knows about this folder.
  const existingRows = await getFolderSyncRows(db, folder.id);
  const existingByPath = new Map(existingRows.map((row) => [row.path, row]));
  const seenPaths = new Set(files.map((file) => file.uri));

  const toDelete = existingRows.filter((row) => !seenPaths.has(row.path)).map((row) => row.path);
  const toExtract = files.filter((file) => {
    const existing = existingByPath.get(file.uri);
    if (!existing || mode === 'full') return true;
    return existing.mtime !== file.lastModified || existing.size !== file.size;
  });

  result.removed = await deleteTracksByPaths(db, toDelete);

  let processed = 0;
  for (let i = 0; i < toExtract.length; i += EXTRACT_BATCH_SIZE) {
    const batch = toExtract.slice(i, i + EXTRACT_BATCH_SIZE);
    const extracted = await AstraLibraryScanner.extractMetadata(
      batch.map((file) => ({ uri: file.uri, coverUri: covers[file.parentUri] ?? null }))
    );
    const metaByUri = new Map(extracted.map((meta) => [meta.uri, meta]));

    const rows: TrackUpsert[] = [];
    for (const file of batch) {
      const meta = metaByUri.get(file.uri);
      if (!meta?.ok) {
        result.errors += 1;
        continue;
      }
      rows.push(metadataToUpsertRow(meta, file, folder.id));
      if (existingByPath.has(file.uri)) {
        result.updated += 1;
      } else {
        result.added += 1;
      }
    }
    await upsertTracks(db, rows);

    processed += batch.length;
    callbacks?.onProgress?.({
      phase: 'extracting',
      processed,
      total: toExtract.length,
      folderName: folder.display_name,
    });
  }

  await markFolderScanned(db, folder.id);
  return result;
}

/** Rescans every folder whose permission grant is still alive. */
export async function rescanAll(
  opts: { mode?: 'incremental' | 'full'; callbacks?: ScanCallbacks } = {}
): Promise<ScanResult> {
  const folders = await loadFolders();
  const total = emptyResult();
  for (const folder of folders) {
    if (!folder.available) continue;
    const result = await scanFolder(folder, opts);
    total.added += result.added;
    total.updated += result.updated;
    total.removed += result.removed;
    total.errors += result.errors;
  }
  return total;
}

/** Explicit user removal: drop the folder (tracks CASCADE) and release the grant. */
export async function removeFolder(folder: Pick<LibraryFolder, 'id' | 'tree_uri'>): Promise<void> {
  const db = await openLibraryDb();
  await deleteFolder(db, folder.id);
  await AstraLibraryScanner.releasePersistedUriPermission(folder.tree_uri);
}

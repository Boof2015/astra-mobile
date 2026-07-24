import { StorageAccessFramework } from 'expo-file-system/legacy';
import {
  AstraLibraryData,
  AstraLibraryScanner,
  type NativeScanResult,
} from '../../modules/astra-library-scanner';
import type { LibraryFolder } from '@/types/library';
import { AUDIO_EXTENSIONS } from './audioExtensions';

export interface ScanProgress {
  phase: 'discovering' | 'extracting' | 'analyzing';
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

type NativeFolder = LibraryFolder & {
  track_count: number;
  scan_status?: string;
  scan_error?: string | null;
};

function displayNameFromTreeUri(treeUri: string): string {
  const lastSegment = treeUri.split('/').pop() ?? treeUri;
  const decoded = decodeURIComponent(lastSegment);
  const name = decoded.split(/[/:]/).pop()?.trim();
  return name || 'Music folder';
}

function scanResult(result: NativeScanResult): ScanResult {
  return {
    added: result.added,
    updated: result.updated,
    removed: result.removed,
    errors: result.errors,
  };
}

export async function loadFolders(): Promise<NativeFolder[]> {
  await AstraLibraryData.initialize();
  return (await AstraLibraryData.listFolders()) as unknown as NativeFolder[];
}

export async function addFolderViaPicker(callbacks?: ScanCallbacks): Promise<ScanResult | null> {
  const permission = await StorageAccessFramework.requestDirectoryPermissionsAsync();
  if (!permission.granted) return null;

  const treeUri = permission.directoryUri;
  await AstraLibraryScanner.takePersistableUriPermission(treeUri);
  const folder = await AstraLibraryData.registerFolder(treeUri, displayNameFromTreeUri(treeUri));
  return scanFolder(folder as unknown as LibraryFolder, { callbacks });
}

export async function scanFolder(
  folder: Omit<LibraryFolder, 'available'> & { available?: boolean },
  opts: { mode?: 'incremental' | 'full'; callbacks?: ScanCallbacks } = {}
): Promise<ScanResult> {
  const { mode = 'incremental', callbacks } = opts;
  const subscription = AstraLibraryScanner.addListener('onScanProgress', (event) => {
    const total = event.total ?? event.found ?? 0;
    callbacks?.onProgress?.({
      phase: event.phase === 'indexing' ? 'analyzing' : event.phase,
      processed: event.processed ?? (event.phase === 'discovering' ? total : 0),
      total,
      folderName: event.folderName ?? folder.display_name,
    });
  });
  try {
    const result = await AstraLibraryScanner.scanFolderNative(folder.id, mode, AUDIO_EXTENSIONS);
    return scanResult(result);
  } finally {
    subscription.remove();
  }
}

export async function rescanAll(
  opts: { mode?: 'incremental' | 'full'; callbacks?: ScanCallbacks } = {}
): Promise<ScanResult> {
  const folders = await loadFolders();
  const total: ScanResult = { added: 0, updated: 0, removed: 0, errors: 0 };
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

export async function removeFolder(folder: Pick<LibraryFolder, 'id'>): Promise<void> {
  await AstraLibraryData.removeFolder(folder.id);
}

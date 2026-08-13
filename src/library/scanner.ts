import { StorageAccessFramework } from 'expo-file-system/legacy';
import {
  AstraLibraryData,
  AstraLibraryScanner,
  type NativeScanResult,
} from '../../modules/astra-library-scanner';
import type { LibraryFolder } from '@/types/library';
import { AUDIO_EXTENSIONS } from './audioExtensions';
import {
  runCancellableFolderScans,
  type ScanCancellationSignal,
  type ScanResult,
} from './scanCancellation';

export {
  createScanCancellationController,
  type ScanCancellationController,
  type ScanCancellationSignal,
  type ScanResult,
} from './scanCancellation';

export interface ScanProgress {
  phase: 'discovering' | 'extracting' | 'analyzing';
  processed: number;
  total: number;
  folderName: string;
}

export interface ScanCallbacks {
  onProgress?: (progress: ScanProgress) => void;
}

type NativeFolder = LibraryFolder & {
  track_count: number;
  scan_status?: string;
  scan_error?: string | null;
  needs_metadata_reindex?: boolean;
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
    cancelled: result.cancelled === true,
  };
}

function cancelledScanResult(): ScanResult {
  return { added: 0, updated: 0, removed: 0, errors: 0, cancelled: true };
}

export function cancelActiveScan(): void {
  const scanner = AstraLibraryScanner as typeof AstraLibraryScanner & {
    cancelScan?: () => void;
  };
  scanner.cancelScan?.();
}

export async function loadFolders(): Promise<NativeFolder[]> {
  await AstraLibraryData.initialize();
  return (await AstraLibraryData.listFolders()) as unknown as NativeFolder[];
}

export async function addFolderViaPicker(
  callbacks?: ScanCallbacks,
  cancellation?: ScanCancellationSignal
): Promise<ScanResult | null> {
  const permission = await StorageAccessFramework.requestDirectoryPermissionsAsync();
  if (!permission.granted) return null;
  if (cancellation?.cancelled) return cancelledScanResult();

  const treeUri = permission.directoryUri;
  await AstraLibraryScanner.takePersistableUriPermission(treeUri);
  const folder = await AstraLibraryData.registerFolder(treeUri, displayNameFromTreeUri(treeUri));
  return scanFolder(folder as unknown as LibraryFolder, { callbacks, cancellation });
}

export async function scanFolder(
  folder: Omit<LibraryFolder, 'available'> & { available?: boolean },
  opts: {
    mode?: 'incremental' | 'full';
    callbacks?: ScanCallbacks;
    cancellation?: ScanCancellationSignal;
  } = {}
): Promise<ScanResult> {
  const { mode = 'incremental', callbacks, cancellation } = opts;
  if (cancellation?.cancelled) return cancelledScanResult();
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
    const mapped = scanResult(result);
    return cancellation?.cancelled ? { ...mapped, cancelled: true } : mapped;
  } finally {
    subscription.remove();
  }
}

export async function rescanAll(
  opts: {
    mode?: 'incremental' | 'full';
    callbacks?: ScanCallbacks;
    cancellation?: ScanCancellationSignal;
  } = {}
): Promise<ScanResult> {
  const folders = await loadFolders();
  return runCancellableFolderScans(
    folders,
    opts.cancellation,
    (folder) => folder.available,
    (folder) => scanFolder(folder, opts)
  );
}

export async function removeFolder(folder: Pick<LibraryFolder, 'id'>): Promise<void> {
  await AstraLibraryData.removeFolder(folder.id);
}

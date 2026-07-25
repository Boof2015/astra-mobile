export interface ScanResult {
  added: number;
  updated: number;
  removed: number;
  errors: number;
  cancelled: boolean;
}

export interface ScanCancellationSignal {
  readonly cancelled: boolean;
}

export interface ScanCancellationController {
  readonly signal: ScanCancellationSignal;
  cancel: () => void;
}

export function createScanCancellationController(): ScanCancellationController {
  let cancelled = false;
  return {
    signal: {
      get cancelled() {
        return cancelled;
      },
    },
    cancel: () => {
      cancelled = true;
    },
  };
}

export async function runCancellableFolderScans<T>(
  folders: readonly T[],
  cancellation: ScanCancellationSignal | undefined,
  isAvailable: (folder: T) => boolean,
  scan: (folder: T) => Promise<ScanResult>
): Promise<ScanResult> {
  const total: ScanResult = {
    added: 0,
    updated: 0,
    removed: 0,
    errors: 0,
    cancelled: false,
  };

  for (const folder of folders) {
    if (!isAvailable(folder)) continue;
    if (cancellation?.cancelled) return { ...total, cancelled: true };

    const result = await scan(folder);
    if (result.cancelled) return { ...total, cancelled: true };

    total.added += result.added;
    total.updated += result.updated;
    total.removed += result.removed;
    total.errors += result.errors;
  }

  return total;
}

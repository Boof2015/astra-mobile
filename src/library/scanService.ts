// Foreground-service keepalive around a library scan. The scan loop runs on the JS
// thread (see scanner.ts), so without a foreground service + wakelock Android throttles
// it the moment the app is backgrounded or the screen sleeps — a big scan would stall.
// This starts the FGS on the first progress tick and tears it down when the scan ends.
// All no-ops on non-Android and on native binaries built before the FGS methods existed.

import { PermissionsAndroid, Platform } from 'react-native';
import { AstraLibraryScanner } from '../../modules/astra-library-scanner';
import type { ScanProgress } from './scanner';

const supported =
  Platform.OS === 'android' &&
  typeof (AstraLibraryScanner as { startScanService?: unknown }).startScanService === 'function';

// runScan guarantees scans never overlap, so single-scan module state is safe.
let active = false;
let notifPermRequested = false;

/**
 * POST_NOTIFICATIONS is Android 13+ (API 33); PermissionsAndroid resolves it granted
 * automatically below that. Requested contextually on the first scan. The FGS +
 * wakelock still keep the scan alive without it — only the visible notification needs it.
 */
async function ensureNotificationPermission(): Promise<void> {
  if (notifPermRequested) return;
  notifPermRequested = true;
  const permission = (PermissionsAndroid.PERMISSIONS as Record<string, string | undefined>)
    .POST_NOTIFICATIONS;
  if (!permission) return;
  try {
    await PermissionsAndroid.request(permission as Parameters<typeof PermissionsAndroid.request>[0]);
  } catch {
    // Denied/unavailable — the scan still runs, the notification just won't show.
  }
}

interface ScanNotification {
  title: string;
  text: string;
  subText: string | null;
  current: number;
  total: number;
  indeterminate: boolean;
}

const n = (value: number) => value.toLocaleString();

function notificationFor(progress: ScanProgress): ScanNotification {
  const folder = progress.folderName?.trim() || null;
  if (progress.phase === 'extracting') {
    return {
      title: 'Scanning your library',
      text: progress.total > 0 ? `${n(progress.processed)} of ${n(progress.total)} files` : 'Reading files…',
      subText: folder,
      current: progress.processed,
      total: progress.total,
      indeterminate: progress.total <= 0,
    };
  }
  if (progress.phase === 'analyzing') {
    return {
      title: 'Analyzing audio',
      text: progress.total > 0 ? `${n(progress.processed)} of ${n(progress.total)} tracks` : 'Analyzing…',
      subText: folder,
      current: progress.processed,
      total: progress.total,
      indeterminate: progress.total <= 0,
    };
  }
  return {
    title: 'Finding your music',
    text: progress.total > 0 ? `${n(progress.total)} files found so far…` : 'Looking through your folders…',
    subText: folder,
    current: 0,
    total: 0,
    indeterminate: true,
  };
}

/** Report a scan progress tick — starts the FGS on the first call, updates it after. */
export async function reportScanProgress(progress: ScanProgress): Promise<void> {
  if (!supported) return;
  const { title, text, subText, current, total, indeterminate } = notificationFor(progress);
  if (!active) {
    active = true;
    await ensureNotificationPermission();
    if (!active) return; // scan ended while we awaited the permission dialog
    AstraLibraryScanner.startScanService(title, text);
  }
  AstraLibraryScanner.updateScanNotification(title, text, subText, current, total, indeterminate);
}

/** Tear down the scan foreground service when a scan finishes (or errors). */
export function endScanService(): void {
  if (!supported || !active) return;
  active = false;
  AstraLibraryScanner.stopScanService();
}

// Foreground-service keepalive around a library scan. The scan loop runs on the JS
// thread (see scanner.ts), so without a foreground service + wakelock Android throttles
// it the moment the app is backgrounded or the screen sleeps — a big scan would stall.
// This starts the FGS on the first progress tick and tears it down when the scan ends.
// All no-ops on non-Android and on native binaries built before the FGS methods existed.

import { Linking, PermissionsAndroid, Platform } from 'react-native';
import { AstraLibraryData, AstraLibraryScanner } from '../../modules/astra-library-scanner';
import type { ScanProgress } from './scanner';

const supported =
  Platform.OS === 'android' &&
  typeof (AstraLibraryScanner as { startScanService?: unknown }).startScanService === 'function';

/**
 * Who currently needs the foreground service. A scan is no longer the only
 * producer — the artist-image sweep runs on the same JS thread and starts right
 * after a scan finishes — so ownership is ref-counted: the service starts when
 * the set becomes non-empty and stops only when the last owner releases it.
 * A plain boolean here would let either side tear down the other's keepalive.
 */
type ServiceOwner = 'scan' | 'artistImages';
const owners = new Set<ServiceOwner>();
const latest = new Map<ServiceOwner, ScanNotification>();

const NOTIFICATION_PERMISSION_REQUESTED_KEY = 'scan_notification_permission_requested';

export type ScanNotificationPermissionState =
  | 'not_required'
  | 'prompt'
  | 'granted'
  | 'denied';

function notificationPermission(): Parameters<typeof PermissionsAndroid.check>[0] | null {
  if (Platform.OS !== 'android' || Number(Platform.Version) < 33) return null;
  const permission = (PermissionsAndroid.PERMISSIONS as Record<string, string | undefined>)
    .POST_NOTIFICATIONS;
  return permission
    ? (permission as Parameters<typeof PermissionsAndroid.check>[0])
    : null;
}

export async function getScanNotificationPermissionState(): Promise<ScanNotificationPermissionState> {
  const permission = notificationPermission();
  if (!permission) return 'not_required';
  if (await PermissionsAndroid.check(permission)) return 'granted';
  const values = await AstraLibraryData.getSettings([NOTIFICATION_PERMISSION_REQUESTED_KEY]);
  return values[NOTIFICATION_PERMISSION_REQUESTED_KEY] === '1' ? 'denied' : 'prompt';
}

export async function requestScanNotificationPermission(): Promise<ScanNotificationPermissionState> {
  const permission = notificationPermission();
  if (!permission) return 'not_required';
  await AstraLibraryData.setSettings({ [NOTIFICATION_PERMISSION_REQUESTED_KEY]: '1' });
  try {
    const result = await PermissionsAndroid.request(permission);
    return result === PermissionsAndroid.RESULTS.GRANTED ? 'granted' : 'denied';
  } catch {
    return 'denied';
  }
}

export async function openScanNotificationSettings(): Promise<void> {
  await Linking.openSettings();
}

export interface ScanNotification {
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

/**
 * Publish a progress tick for one owner — starts the service on the first call,
 * updates the notification after. A scan outranks the sweep when both are live:
 * it is the operation the user just asked for, and it finishes sooner.
 */
export function reportServiceProgress(
  owner: ServiceOwner,
  notification: ScanNotification
): void {
  if (!supported) return;
  const starting = owners.size === 0;
  owners.add(owner);
  latest.set(owner, notification);
  if (starting) {
    AstraLibraryScanner.startScanService(notification.title, notification.text);
  }
  publish();
}

/** Release one owner's claim; the service stops once nobody holds it. */
export function endServiceFor(owner: ServiceOwner): void {
  if (!supported || !owners.has(owner)) return;
  owners.delete(owner);
  latest.delete(owner);
  if (owners.size > 0) {
    publish();
    return;
  }
  AstraLibraryScanner.stopScanService();
}

function publish(): void {
  const owner: ServiceOwner = owners.has('scan') ? 'scan' : 'artistImages';
  const next = latest.get(owner);
  if (!next) return;
  AstraLibraryScanner.updateScanNotification(
    next.title,
    next.text,
    next.subText,
    next.current,
    next.total,
    next.indeterminate
  );
}

/** Report a scan progress tick — starts the FGS on the first call, updates it after. */
export async function reportScanProgress(progress: ScanProgress): Promise<void> {
  reportServiceProgress('scan', notificationFor(progress));
}

/** Tear down the scan's claim on the foreground service when a scan finishes (or errors). */
export function endScanService(): void {
  endServiceFor('scan');
}

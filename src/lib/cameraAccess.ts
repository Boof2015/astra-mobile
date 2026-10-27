export type CameraAccessStatus = 'checking' | 'granted' | 'prompt' | 'blocked';

/** The slice of expo's PermissionResponse the scanners branch on. */
export interface CameraPermissionSnapshot {
  granted: boolean;
  canAskAgain: boolean;
}

/**
 * `blocked` is Android's "don't ask again": requesting returns denied without
 * showing a dialog, so the only way forward is the app's system settings.
 */
export function cameraAccessStatus(
  permission: CameraPermissionSnapshot | null
): CameraAccessStatus {
  if (!permission) return 'checking';
  if (permission.granted) return 'granted';
  return permission.canAskAgain ? 'prompt' : 'blocked';
}

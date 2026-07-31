import { useCallback, useEffect, useState } from 'react';
import { useAppForeground } from '@/lib/useAppForeground';
import {
  getScanNotificationPermissionState,
  openScanNotificationSettings,
  requestScanNotificationPermission,
  type ScanNotificationPermissionState,
} from '@/library/scanService';

export interface ScanNotificationPermission {
  /** null until the first native check resolves. */
  state: ScanNotificationPermissionState | null;
  /** True once the permission is held, or when the OS never required it. */
  granted: boolean;
  /** Already refused once — `resolve` opens Android settings instead of re-asking. */
  denied: boolean;
  working: boolean;
  /** Requests the permission, or opens Android settings once it has been denied. */
  resolve: () => void;
}

/**
 * Shared POST_NOTIFICATIONS state for the scan progress notification, used by
 * both the settings row and the onboarding step. Re-checks on every return to
 * the foreground because the grant can be flipped in Android settings while
 * Astra is backgrounded.
 */
export function useScanNotificationPermission(): ScanNotificationPermission {
  const [state, setState] = useState<ScanNotificationPermissionState | null>(null);
  const [working, setWorking] = useState(false);
  const foreground = useAppForeground();

  useEffect(() => {
    if (!foreground) return;
    let cancelled = false;
    void getScanNotificationPermissionState().then((next) => {
      if (!cancelled) setState(next);
    });
    return () => {
      cancelled = true;
    };
  }, [foreground]);

  const denied = state === 'denied';
  const resolve = useCallback(() => {
    if (working) return;
    if (denied) {
      void openScanNotificationSettings();
      return;
    }
    setWorking(true);
    void requestScanNotificationPermission()
      .then(setState)
      .finally(() => setWorking(false));
  }, [denied, working]);

  return {
    state,
    granted: state === 'granted' || state === 'not_required',
    denied,
    working,
    resolve,
  };
}

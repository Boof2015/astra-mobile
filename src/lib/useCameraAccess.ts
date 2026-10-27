import { useEffect, useEffectEvent, useState } from 'react';
import { Linking } from 'react-native';
import { useCameraPermissions } from 'expo-camera';
import { cameraAccessStatus } from './cameraAccess';
import { useAppForeground } from './useAppForeground';

/**
 * A grant lands in the same resume that brings Astra back from the system
 * permission dialog. Views created in that resume came up dead (the scanner
 * frame drew its background but none of its children, camera included, until
 * the screen was reopened), so after a fresh grant the whole scanner waits for
 * the dialog to finish leaving before it mounts.
 */
const CAMERA_GRANT_SETTLE_MS = 500;
/** CameraX reports OPEN well inside this; past it, the preview is presumed dead. */
const CAMERA_READY_TIMEOUT_MS = 1500;
const MAX_CAMERA_REMOUNTS = 2;

/**
 * Camera permission + scanner mount state shared by the scanner screens.
 * Render the scanner (frame and CameraView) only while `scannerReady`, and pass
 * `cameraKey`, `onCameraReady` and `onMountError` to the CameraView.
 */
export function useCameraAccess() {
  const [permission, requestPermission, getPermission] = useCameraPermissions();
  const foreground = useAppForeground();
  const status = cameraAccessStatus(permission);
  const [seenStatus, setSeenStatus] = useState(status);
  const [settling, setSettling] = useState(false);
  const [cameraKey, setCameraKey] = useState(0);
  const [cameraReady, setCameraReady] = useState(false);
  const [remounts, setRemounts] = useState(0);

  // Adjusted during render, not in an effect: the render that first sees the
  // grant must already be settling, or the scanner mounts for one commit.
  if (status !== seenStatus) {
    setSeenStatus(status);
    if (status === 'granted' && (seenStatus === 'prompt' || seenStatus === 'blocked')) {
      setSettling(true);
    }
  }
  const scannerReady = status === 'granted' && !settling;

  useEffect(() => {
    if (!settling) return;
    const timeout = setTimeout(() => setSettling(false), CAMERA_GRANT_SETTLE_MS);
    return () => clearTimeout(timeout);
  }, [settling]);

  // Coming back from system settings (or a dialog whose answer never reached
  // JS) leaves the hook's answer stale; ask again on every return.
  const currentStatus = useEffectEvent(() => status);
  useEffect(() => {
    // The hook's own mount-time check is still in flight.
    if (!foreground || currentStatus() === 'checking') return;
    void getPermission();
  }, [foreground, getPermission]);

  // Fallback for a mount that still comes up dead: a CameraView that never
  // reports ready is replaced with a fresh one.
  useEffect(() => {
    if (!scannerReady || !foreground || cameraReady || remounts >= MAX_CAMERA_REMOUNTS) return;
    const timeout = setTimeout(() => {
      setRemounts((count) => count + 1);
      setCameraKey((key) => key + 1);
    }, CAMERA_READY_TIMEOUT_MS);
    return () => clearTimeout(timeout);
  }, [scannerReady, foreground, cameraReady, remounts]);

  const requestAccess = async () => {
    if (status === 'blocked') {
      await Linking.openSettings().catch(() => {});
      return;
    }
    await requestPermission();
  };

  return {
    status,
    requestAccess,
    scannerReady,
    cameraKey,
    onCameraReady: () => setCameraReady(true),
    onMountError: () => {
      if (remounts >= MAX_CAMERA_REMOUNTS) return;
      setCameraReady(false);
      setRemounts((count) => count + 1);
      setCameraKey((key) => key + 1);
    },
  };
}

import { NativeModules, Platform } from 'react-native';

interface TrackPlayerModuleExtension {
  setPauseAtEndOfItem?: (enabled: boolean) => Promise<void>;
}

const nativeTrackPlayer = NativeModules.TrackPlayerModule as TrackPlayerModuleExtension | undefined;

export function supportsNativePauseAtEndOfItem(): boolean {
  return Platform.OS === 'android' && typeof nativeTrackPlayer?.setPauseAtEndOfItem === 'function';
}

export async function setPauseAtEndOfItem(enabled: boolean): Promise<void> {
  if (!supportsNativePauseAtEndOfItem()) {
    if (enabled) throw new Error('End-of-track timers are unavailable on this device.');
    return;
  }
  await nativeTrackPlayer?.setPauseAtEndOfItem?.(enabled);
}

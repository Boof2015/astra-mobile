import { requireOptionalNativeModule, type NativeModule } from 'expo-modules-core';
import type { AudioOutputRoute } from '../../src/types/audio';

type AstraAudioRouteEvents = {
  onAudioRouteChanged: (route: AudioOutputRoute | null) => void;
};

declare class AstraAudioRouteModuleType extends NativeModule<AstraAudioRouteEvents> {
  getCurrentRoute(): AudioOutputRoute | null;
  start(): void;
  stop(): void;
}

const native = requireOptionalNativeModule<AstraAudioRouteModuleType>('AstraAudioRoute');

export const isAstraAudioRouteAvailable = native !== null;

export const AstraAudioRoute = native ?? {
  addListener: () => ({ remove: () => {} }),
  removeAllListeners: () => {},
  getCurrentRoute: () => null,
  start: () => {},
  stop: () => {},
};

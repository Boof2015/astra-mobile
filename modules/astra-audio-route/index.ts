import { requireOptionalNativeModule, type NativeModule } from 'expo-modules-core';
import type { AudioOutputRoute } from '../../src/types/audio';
import type { AudioDiagnosticsSnapshot } from '../../src/audio/audioDiagnostics';

type AstraAudioRouteEvents = {
  onAudioRouteChanged: (route: AudioOutputRoute | null) => void;
};

declare class AstraAudioRouteModuleType extends NativeModule<AstraAudioRouteEvents> {
  getCurrentRoute(): AudioOutputRoute | null;
  getAudioDiagnostics(): AudioDiagnosticsSnapshot;
  start(): void;
  stop(): void;
}

const native = requireOptionalNativeModule<AstraAudioRouteModuleType>('AstraAudioRoute');

export const isAstraAudioRouteAvailable = native !== null;

export const AstraAudioRoute = native ?? {
  addListener: () => ({ remove: () => {} }),
  removeAllListeners: () => {},
  getCurrentRoute: () => null,
  getAudioDiagnostics: (): AudioDiagnosticsSnapshot | null => null,
  start: () => {},
  stop: () => {},
};

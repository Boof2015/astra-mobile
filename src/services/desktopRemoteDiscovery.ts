import { Platform } from 'react-native';
import { requireOptionalNativeModule, type NativeModule } from 'expo-modules-core';
import type { DesktopRemoteDiscoveredDesktop } from '@/types/desktopRemote';

type DiscoveryEvents = {
  onDesktopRemoteFound: (desktop: DesktopRemoteDiscoveredDesktop) => void;
  onDesktopRemoteLost: (event: { name: string }) => void;
};

declare class AstraDesktopDiscoveryModuleType extends NativeModule<DiscoveryEvents> {
  start(): Promise<void>;
  stop(): Promise<void>;
  getCached(): DesktopRemoteDiscoveredDesktop[];
}

const native = requireOptionalNativeModule<AstraDesktopDiscoveryModuleType>('AstraDesktopDiscovery');

export const desktopRemoteDiscoveryAvailable = Platform.OS === 'android' && native != null;

export const AstraDesktopDiscovery = native ?? {
  addListener: () => ({ remove: () => {} }),
  removeAllListeners: () => {},
  start: async () => {},
  stop: async () => {},
  getCached: () => [],
};

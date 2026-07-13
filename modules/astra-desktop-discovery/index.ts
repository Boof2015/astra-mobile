import { requireOptionalNativeModule, type NativeModule } from 'expo-modules-core';

export interface AstraDesktopDiscoveryItem {
  endpointUuid: string | null;
  desktopName: string | null;
  protocolVersion: number;
  certificateFingerprint: string;
  transport: 'https';
  name: string;
  baseUrl: string;
  address: string;
  port: number;
  lastSeenAt: number;
}

type AstraDesktopDiscoveryEvents = {
  onDesktopRemoteFound: (desktop: AstraDesktopDiscoveryItem) => void;
  onDesktopRemoteLost: (event: { name: string }) => void;
};

declare class AstraDesktopDiscoveryModuleType extends NativeModule<AstraDesktopDiscoveryEvents> {
  start(): Promise<void>;
  stop(): Promise<void>;
  getCached(): AstraDesktopDiscoveryItem[];
}

const native = requireOptionalNativeModule<AstraDesktopDiscoveryModuleType>('AstraDesktopDiscovery');

export const AstraDesktopDiscovery = native ?? {
  addListener: () => ({ remove: () => {} }),
  removeAllListeners: () => {},
  start: async () => {},
  stop: async () => {},
  getCached: () => [],
};

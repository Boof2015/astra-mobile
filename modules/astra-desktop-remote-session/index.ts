import { requireOptionalNativeModule, type NativeModule } from 'expo-modules-core';

export type AstraDesktopRemoteSessionCommand =
  | { command: 'play' }
  | { command: 'pause' }
  | { command: 'toggle-play' }
  | { command: 'previous' }
  | { command: 'next' }
  | { command: 'toggle-favorite' }
  | { command: 'seek'; position: number }
  | { command: 'stop' };

export interface AstraDesktopRemoteSessionState {
  title?: string | null;
  artist?: string | null;
  album?: string | null;
  desktopName?: string | null;
  artworkDataUrl?: string | null;
  playbackState: 'stopped' | 'playing' | 'paused' | 'loading';
  hasTrack: boolean;
  duration?: number | null;
  position?: number | null;
  updatedAt?: number | null;
  isFavorite?: boolean;
}

type AstraDesktopRemoteSessionEvents = {
  onDesktopRemoteCommand: (event: AstraDesktopRemoteSessionCommand) => void;
};

declare class AstraDesktopRemoteSessionModuleType extends NativeModule<AstraDesktopRemoteSessionEvents> {
  setNowPlaying(state: AstraDesktopRemoteSessionState): void;
  clear(): void;
}

const native = requireOptionalNativeModule<AstraDesktopRemoteSessionModuleType>('AstraDesktopRemoteSession');

export const AstraDesktopRemoteSession = native ?? {
  addListener: () => ({ remove: () => {} }),
  removeAllListeners: () => {},
  setNowPlaying: () => {},
  clear: () => {},
};

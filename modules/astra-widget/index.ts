import { requireOptionalNativeModule, type NativeModule } from 'expo-modules-core';

import type { PlaybackState } from '@/types/audio';

export interface AstraWidgetNowPlayingState {
  title?: string | null;
  artist?: string | null;
  artworkUri?: string | null;
  playbackState: PlaybackState;
  hasTrack: boolean;
  recentlyPlayed?: AstraWidgetRecentItem[];
  replaceRecentlyPlayed?: boolean;
}

export interface AstraWidgetRecentItem {
  title?: string | null;
  artist?: string | null;
  artworkUri?: string | null;
}

declare class AstraWidgetModuleType extends NativeModule {
  setNowPlaying(state: AstraWidgetNowPlayingState): void;
}

const native = requireOptionalNativeModule<AstraWidgetModuleType>('AstraWidget');

export const AstraWidget = (native ?? {
  setNowPlaying: () => {},
}) as AstraWidgetModuleType;

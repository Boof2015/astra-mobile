import { requireOptionalNativeModule, type NativeModule } from 'expo-modules-core';

import type { PlaybackState } from '@/types/audio';

export interface AstraCarNowPlayingState {
  title?: string | null;
  artist?: string | null;
  album?: string | null;
  /** Local cached artwork file name; native builds a content:// URI from it. */
  artworkHash?: string | null;
  /** Remote server cover id (Subsonic/Jellyfin); used with artworkSourceKey. */
  artworkSourceId?: string | null;
  /** Remote source row id (remote_sources.id) that owns artworkSourceId. */
  artworkSourceKey?: number | null;
  playbackState: PlaybackState;
  hasTrack: boolean;
  duration?: number | null;
  position?: number | null;
  trackPath?: string | null;
  isFavorite?: boolean;
}

declare class AstraCarModuleType extends NativeModule {
  setNowPlaying(state: AstraCarNowPlayingState): void;
}

const native = requireOptionalNativeModule<AstraCarModuleType>('AstraCar');

export const AstraCar = (native ?? {
  setNowPlaying: () => {},
}) as AstraCarModuleType;

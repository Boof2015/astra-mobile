import { requireOptionalNativeModule, type NativeModule } from 'expo-modules-core';

import type { PlaybackState } from '@/types/audio';

export interface AstraWidgetNowPlayingState {
  title?: string | null;
  artist?: string | null;
  /** The cover's thumbnail: the widget computes its cover colors from it, as the app does. */
  artworkUri?: string | null;
  /** The full-size cover, so large widget sizes stay sharp. */
  artworkFullUri?: string | null;
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

/** The palette tokens the widget's "Astra" style uses, as `#rrggbb`. */
export interface AstraWidgetThemeTokens {
  bgPrimary: string;
  bgSecondary: string;
  bgTertiary: string;
  textPrimary: string;
  accent: string;
  accentText: string;
}

export interface AstraWidgetAppTheme {
  dark: AstraWidgetThemeTokens;
  light: AstraWidgetThemeTokens;
  /** The app is on Material You: the widget uses the system's live colors instead. */
  materialYou: boolean;
}

/** A widget button, delivered while Astra's JS is running. */
export type AstraWidgetCommand = 'togglePlay' | 'next' | 'previous';

type AstraWidgetEvents = {
  onCommand: (event: { command: AstraWidgetCommand }) => void;
};

declare class AstraWidgetModuleType extends NativeModule<AstraWidgetEvents> {
  setNowPlaying(state: AstraWidgetNowPlayingState): void;
  setAppTheme(theme: AstraWidgetAppTheme): void;
}

const native = requireOptionalNativeModule<AstraWidgetModuleType>('AstraWidget');

export const AstraWidget = (native ?? {
  setNowPlaying: () => {},
  setAppTheme: () => {},
  addListener: () => ({ remove: () => {} }),
}) as unknown as AstraWidgetModuleType;

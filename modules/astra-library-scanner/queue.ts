import {
  requireNativeModule,
  requireNativeViewManager,
  type NativeModule,
} from 'expo-modules-core';
import { processColor, type ViewProps } from 'react-native';
import type { Palette } from '../../src/theme/palettes';

export interface NativeQueuePalette {
  background: number;
  surface: number;
  elevatedSurface: number;
  selectedSurface: number;
  nowPlayingSurface: number;
  divider: number;
  ripple: number;
  text: number;
  textSecondary: number;
  textTertiary: number;
  accent: number;
  accentText: number;
  accentTextStrong: number;
  warning: number;
}

export interface NativeQueuePresentationOptions {
  palette: NativeQueuePalette;
}

export interface NativeQueuePlaybackRequest {
  requestId: string;
  kind: 'playEntry';
  entryId: number;
  queueRevision: number;
}

export interface NativeQueueRevisionEvent {
  sessionId: string | null;
  queueRevision: number;
  activePosition: number;
  totalCount: number;
}

type AstraQueueEvents = {
  onDismissed: () => void;
  onPlaybackRequest: (event: NativeQueuePlaybackRequest) => void;
  onQueueRevision: (event: NativeQueueRevisionEvent) => void;
};

declare class AstraQueueModuleType extends NativeModule<AstraQueueEvents> {
  present(options: NativeQueuePresentationOptions): Promise<void>;
  dismiss(): void;
  /**
   * Re-theme an already-presented sheet. The palette given to `present` is only
   * correct until the next track change, because the accent is derived from
   * cover art.
   */
  updatePalette(palette: NativeQueuePalette): void;
  resolvePlaybackRequest(
    requestId: string,
    success: boolean,
    message?: string | null,
  ): void;
  resolveEntryPosition(
    entryId: number,
    expectedRevision: number,
  ): Promise<number | null>;
}

export interface AstraQueueViewProps extends ViewProps {
  active: boolean;
  palette: NativeQueuePalette;
  /**
   * Embedded as the now-playing companion pane rather than presented as a
   * sheet. Drops the "Queue" title and its count — the pane is reached from a
   * button that already names it, and the player header a few hundred dp to the
   * left already says what is playing from where. Edit stays: it is a function,
   * not a label.
   */
  paneMode?: boolean;
}

function nativeColor(value: string): number {
  const processed = processColor(value);
  return typeof processed === 'number' ? processed : 0;
}

export function toNativeQueuePalette(colors: Palette): NativeQueuePalette {
  return {
    background: nativeColor(colors.bgSecondary),
    surface: nativeColor(colors.bgSecondary),
    elevatedSurface: nativeColor(colors.bgTertiary),
    selectedSurface: nativeColor(colors.glassHighlight),
    nowPlayingSurface: nativeColor(colors.glassBg),
    divider: nativeColor(colors.glassBorder),
    ripple: nativeColor(colors.ripple),
    text: nativeColor(colors.textPrimary),
    textSecondary: nativeColor(colors.textSecondary),
    textTertiary: nativeColor(colors.textTertiary),
    accent: nativeColor(colors.accent),
    accentText: nativeColor(colors.accentText),
    accentTextStrong: nativeColor(colors.accentTextStrong),
    // Destructive queue actions are semantically different from Astra's amber
    // warning token. Keep remove affordances unmistakably red in every theme.
    warning: nativeColor('#ef5350'),
  };
}

export const AstraQueue = requireNativeModule<AstraQueueModuleType>('AstraQueue');
export const AstraQueueView =
  requireNativeViewManager<AstraQueueViewProps>('AstraQueue');

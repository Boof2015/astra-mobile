import { requireOptionalNativeModule, type NativeModule } from 'expo-modules-core';

/**
 * Android 12+ monet system palettes (wallpaper-derived). Each ramp is 13 hex
 * strings ordered by tone [0, 10, 50, 100, 200, ..., 900, 1000] — tone 0 is
 * white-ish, tone 1000 black-ish.
 */
export interface SystemPalette {
  accent1: string[];
  accent2: string[];
  accent3: string[];
  neutral1: string[];
  neutral2: string[];
}

declare class AstraSystemColorsModuleType extends NativeModule {
  /** True on Android 12+ builds that include the native module. */
  isAvailable(): boolean;
  /** Current monet ramps, or null when unavailable. Sync — resource reads are microseconds. */
  getSystemPalette(): SystemPalette | null;
}

const native = requireOptionalNativeModule<AstraSystemColorsModuleType>('AstraSystemColors');

export const AstraSystemColors = (native ?? {
  isAvailable: () => false,
  getSystemPalette: () => null,
}) as AstraSystemColorsModuleType;

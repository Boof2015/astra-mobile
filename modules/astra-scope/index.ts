import { requireNativeModule, type NativeModule } from 'expo-modules-core';

/** Number of spectrum bins returned by getSpectrumFrame (fftSize/2, fftSize=2048). */
export const SPECTRUM_BINS = 1024;

/** Spectrum values are dB magnitudes in this range (silence ~ -100). */
export const SPECTRUM_DB_MIN = -100;
export const SPECTRUM_DB_MAX = 0;

declare class AstraScopeModuleType extends NativeModule {
  /** Gate the audio-thread PCM tap. Off when backgrounded/paused/reduced-motion. */
  setActive(active: boolean): void;
  /**
   * Fill `out` (length should be {@link SPECTRUM_BINS}) with the latest dB
   * spectrum magnitudes in place; returns the number of bins written. Call once
   * per render frame from the JS thread.
   */
  getSpectrumFrame(out: Float32Array): number;
}

export const AstraScope = requireNativeModule<AstraScopeModuleType>('AstraScope');

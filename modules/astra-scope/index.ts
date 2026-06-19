import { requireNativeModule, type NativeModule } from 'expo-modules-core';

/** Number of spectrum bins returned by getSpectrumFrame (fftSize/2, fftSize=2048). */
export const SPECTRUM_BINS = 1024;

/** Spectrum values are dB magnitudes in this range (silence ~ -100). */
export const SPECTRUM_DB_MIN = -100;
export const SPECTRUM_DB_MAX = 0;

/** Render-ready oscilloscope point count requested by the mobile UI. */
export const OSCILLOSCOPE_POINTS = 256;

declare class AstraScopeModuleType extends NativeModule {
  /** Gate the audio-thread PCM tap. Off when backgrounded/paused/reduced-motion. */
  setActive(active: boolean): void;
  /**
   * Fill `out` (length should be {@link SPECTRUM_BINS}) with the latest dB
   * spectrum magnitudes in place; returns the number of bins written. Call once
   * per render frame from the JS thread.
   */
  getSpectrumFrame(out: Float32Array): number;
  /**
   * Fill `out` with render-ready, evenly spaced points from the latest
   * pitch-locked oscilloscope window. Values are interpolated visual samples in
   * ~[-1, 1]. Returns the number of points written (0 before warmup).
   */
  getOscilloscopeFrame(out: Float32Array): number;
  /** Gate the post-EQ tap (true only while the EQ screen is visible). */
  setActivePostEq(active: boolean): void;
  /**
   * Like {@link getSpectrumFrame} but for the POST-EQ tap (ring #2) — feeds the
   * EQ screen's spectrum behind the response curve. Returns bins written.
   */
  getSpectrumFramePostEq(out: Float32Array): number;

  // --- M4 EQ + per-track gain (params pushed from JS; biquad coeffs computed
  // natively at the real stream sample rate) ---

  /** Master EQ bypass. When false the EqAudioProcessor is passthrough. */
  setEqEnabled(enabled: boolean): void;
  /** EQ preamp as a linear amplitude (1 = unity). */
  setEqPreamp(linear: number): void;
  /**
   * Flat band params: 5 values per band — [typeOrdinal, frequency, gain, Q,
   * enabled?1:0]. Native recomputes biquad coefficients at the stream rate.
   */
  setEqBands(params: number[]): void;
  /** Set the active per-track normalization/ReplayGain gain (linear; 1 = unity). */
  setNormalizationGain(linear: number): void;
  /**
   * Register a queued track's gain by URL. The player switches the active gain to the
   * matching entry natively at the media-item transition (no JS round-trip).
   */
  setTrackGain(url: string, linear: number): void;
  /** Activate the registered gain for this URL now (current track on mount/settings). */
  activateTrackGain(url: string): void;
  /** Drop all registered per-track gains. */
  clearTrackGains(): void;
}

export const AstraScope = requireNativeModule<AstraScopeModuleType>('AstraScope');

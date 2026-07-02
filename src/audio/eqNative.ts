// Thin, defensive wrapper over the native EQ/gain setters on the AstraScope module.
// Guards every call so a JS bundle running against an older native binary (before the
// M4 native rebuild) degrades to a no-op instead of crashing.

import { AstraScope } from '../../modules/astra-scope';

type NativeEq = {
  setEqEnabled?: (enabled: boolean) => void;
  setEqPreamp?: (linear: number) => void;
  setEqBands?: (params: number[]) => void;
  setNormalizationGain?: (linear: number) => void;
  setTrackGain?: (url: string, linear: number) => void;
  setTrackGains?: (entries: Record<string, number>, clearExisting: boolean) => void;
  activateTrackGain?: (url: string) => void;
  setFallbackGain?: (linear: number) => void;
  setActivePostEq?: (active: boolean) => void;
};

const native = AstraScope as unknown as NativeEq;

export function setEqEnabledNative(enabled: boolean): void {
  try {
    native.setEqEnabled?.(enabled);
  } catch {
    /* older native binary — no-op */
  }
}

export function setEqPreampNative(linear: number): void {
  try {
    native.setEqPreamp?.(linear);
  } catch {
    /* no-op */
  }
}

export function setEqBandsNative(params: number[]): void {
  try {
    native.setEqBands?.(params);
  } catch {
    /* no-op */
  }
}

/** Glide the active normalization gain to an explicit linear value. 1 = unity. */
export function setNormalizationGainNative(linear: number): void {
  try {
    native.setNormalizationGain?.(linear);
  } catch {
    /* no-op */
  }
}

/**
 * Register a queued track's gain by URL so the player switches to it natively at the
 * media-item transition (no JS round-trip on track change).
 */
export function setTrackGainNative(url: string, linear: number): void {
  try {
    native.setTrackGain?.(url, linear);
  } catch {
    /* no-op */
  }
}

/**
 * Bulk-register queued tracks' gains (url -> linear) in one bridge call. With
 * `clearExisting` the native map is cleared first (bounds it to the live queue).
 */
export function setTrackGainsNative(
  entries: Record<string, number>,
  clearExisting: boolean
): void {
  try {
    native.setTrackGains?.(entries, clearExisting);
  } catch {
    /* no-op */
  }
}

/** Glide to the registered gain for this URL now (mount/settings/late measurement). */
export function activateTrackGainNative(url: string): void {
  try {
    native.activateTrackGain?.(url);
  } catch {
    /* no-op */
  }
}

/**
 * Conservative temp gain applied natively when a media-item transition hits a URL
 * with no registered gain (unanalyzed track). Pinned to 1 while normalization is off.
 */
export function setFallbackGainNative(linear: number): void {
  try {
    native.setFallbackGain?.(linear);
  } catch {
    /* no-op */
  }
}

/** Gate the post-EQ tap (true only while the EQ screen is visible). */
export function setActivePostEqNative(active: boolean): void {
  try {
    native.setActivePostEq?.(active);
  } catch {
    /* no-op */
  }
}

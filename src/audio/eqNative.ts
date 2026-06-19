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
  activateTrackGain?: (url: string) => void;
  clearTrackGains?: () => void;
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

/** Set the active normalization/ReplayGain gain directly (linear). 1 = unity. */
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

/** Activate the registered gain for this URL now (current track on mount/settings). */
export function activateTrackGainNative(url: string): void {
  try {
    native.activateTrackGain?.(url);
  } catch {
    /* no-op */
  }
}

/** Drop all registered per-track gains. */
export function clearTrackGainsNative(): void {
  try {
    native.clearTrackGains?.();
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

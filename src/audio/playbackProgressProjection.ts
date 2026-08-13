export interface PlaybackProgressSnapshot {
  currentTime: number;
  duration: number;
  isPlaying: boolean;
  active: boolean;
  trackKey?: string | number | null;
  overrideFraction?: number | null;
}

export interface PlaybackProgressReconciliation {
  fraction: number;
  animate: boolean;
  animationDurationMs: number;
  trackChanged: boolean;
}

export function clampPlaybackFraction(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  if (value >= 1) return 1;
  return value;
}

/**
 * Turns an RNTP snapshot into one UI-thread command. Seek/scrub overrides win,
 * pauses and hidden surfaces snap, and active playback runs linearly to the end
 * until the next authoritative snapshot reconciles it.
 */
export function reconcilePlaybackProgress(
  snapshot: PlaybackProgressSnapshot,
  previousTrackKey?: string | number | null
): PlaybackProgressReconciliation {
  const duration = Number.isFinite(snapshot.duration) ? Math.max(0, snapshot.duration) : 0;
  const currentTime = Number.isFinite(snapshot.currentTime)
    ? Math.max(0, snapshot.currentTime)
    : 0;
  const liveFraction = duration > 0
    ? clampPlaybackFraction(currentTime / duration)
    : 0;
  const hasOverride = snapshot.overrideFraction != null;
  const fraction = hasOverride
    ? clampPlaybackFraction(snapshot.overrideFraction as number)
    : liveFraction;
  const trackChanged =
    previousTrackKey !== undefined && previousTrackKey !== snapshot.trackKey;
  const animate =
    !hasOverride &&
    snapshot.active &&
    snapshot.isPlaying &&
    duration > 0 &&
    fraction < 1;

  return {
    fraction,
    animate,
    animationDurationMs: animate
      ? Math.max(0, Math.round((duration - currentTime) * 1_000))
      : 0,
    trackChanged,
  };
}

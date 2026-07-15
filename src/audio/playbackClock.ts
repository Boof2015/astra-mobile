export interface PlaybackClock {
  anchorTime: number;
  anchorTimestampMs: number;
  isPlaying: boolean;
}

export function clampPlaybackTime(value: number, duration: number): number {
  if (!Number.isFinite(value)) return 0;
  if (duration <= 0) return Math.max(0, value);
  return Math.min(duration, Math.max(0, value));
}

export function createPlaybackClock(
  currentTime: number,
  duration: number,
  isPlaying: boolean,
  nowMs = 0
): PlaybackClock {
  return {
    anchorTime: clampPlaybackTime(currentTime, duration),
    anchorTimestampMs: nowMs,
    isPlaying,
  };
}

export function projectPlaybackClock(
  clock: PlaybackClock,
  duration: number,
  nowMs: number
): number {
  if (!clock.isPlaying) return clampPlaybackTime(clock.anchorTime, duration);
  const elapsedSeconds = Math.max(0, nowMs - clock.anchorTimestampMs) / 1000;
  return clampPlaybackTime(clock.anchorTime + elapsedSeconds, duration);
}

/** Re-anchor to an authoritative RNTP/store progress snapshot. */
export function applyPlaybackSnapshot(
  clock: PlaybackClock,
  currentTime: number,
  duration: number,
  nowMs: number
): PlaybackClock {
  return {
    anchorTime: clampPlaybackTime(currentTime, duration),
    anchorTimestampMs: nowMs,
    isPlaying: clock.isPlaying,
  };
}

/**
 * Freeze the projected clock when playback stops, or resume from that frozen
 * point without counting any time spent paused.
 */
export function setPlaybackClockRunning(
  clock: PlaybackClock,
  isPlaying: boolean,
  duration: number,
  nowMs: number
): PlaybackClock {
  return {
    anchorTime: projectPlaybackClock(clock, duration, nowMs),
    anchorTimestampMs: nowMs,
    isPlaying,
  };
}

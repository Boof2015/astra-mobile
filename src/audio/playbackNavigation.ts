import type { PlaybackState } from '@/types/audio';

export const PREVIOUS_RESTART_THRESHOLD_SECONDS = 3;

/** Match desktop Astra: restart only after crossing the previous-track cutoff. */
export function shouldRestartOnPrevious(positionSeconds: number): boolean {
  return (
    Number.isFinite(positionSeconds) &&
    positionSeconds > PREVIOUS_RESTART_THRESHOLD_SECONDS
  );
}

/**
 * An explicit Next press while paused is also an instruction to resume.
 * Loading, stopped, and already-playing sessions retain their native behavior.
 */
export function shouldResumeAfterExplicitNext(
  playbackState: PlaybackState,
): boolean {
  return playbackState === 'paused';
}

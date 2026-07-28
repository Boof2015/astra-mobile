export const LISTENING_CHECKPOINT_SECONDS = 10;
export const LISTENING_QUALIFICATION_SECONDS = 15;
export const LISTENING_NATURAL_END_TOLERANCE_SECONDS = 1;

/** Wall-clock delta that is safe to count for one actively-playing progress tick. */
export function listenedTickDeltaMs(
  lastTickAt: number | null,
  now: number,
  activelyPlaying: boolean,
): number {
  if (!activelyPlaying || lastTickAt == null || !Number.isFinite(now)) return 0;
  return Math.max(0, now - lastTickAt);
}

export function listeningCheckpointDue(options: {
  listenedSeconds: number;
  lastCheckpointSeconds: number;
  qualificationCheckpointSent: boolean;
  durationSeconds: number;
}): boolean {
  const sinceCheckpoint =
    options.listenedSeconds - options.lastCheckpointSeconds >= LISTENING_CHECKPOINT_SECONDS;
  const reachedQualification =
    !options.qualificationCheckpointSent &&
    options.durationSeconds >= LISTENING_QUALIFICATION_SECONDS &&
    options.listenedSeconds >= LISTENING_QUALIFICATION_SECONDS;
  return sinceCheckpoint || reachedQualification;
}

export function playbackAppearsNaturallyCompleted(
  durationSeconds: number,
  positionSeconds: number,
): boolean {
  if (
    !Number.isFinite(durationSeconds) ||
    !Number.isFinite(positionSeconds) ||
    durationSeconds <= 0 ||
    positionSeconds < 0
  ) {
    return false;
  }
  return positionSeconds >= Math.max(
    0,
    durationSeconds - LISTENING_NATURAL_END_TOLERANCE_SECONDS,
  );
}

export const RECENT_PLAY_MIN_SECONDS = 15;
export const SHORT_TRACK_COMPLETION_TOLERANCE_SECONDS = 0.5;
export const SHORT_TRACK_COMPLETION_TOLERANCE_RATIO = 0.1;
export const MANUAL_RECENT_PLAY_TRANSITION_TTL_MS = 5_000;

export interface RecentPlayCandidate {
  path: string | null;
  durationSeconds: number | null;
  accumulatedMs: number;
  playingSinceMs: number | null;
  recorded: boolean;
}

export interface RecentPlayEvaluation {
  candidate: RecentPlayCandidate;
  recordPath: string | null;
}

export interface ManualRecentPlayTransitionToken {
  id: number;
}

interface PendingManualRecentPlayTransition {
  id: number;
  fromPath: string;
  expiresAtMs: number;
}

let nextManualTransitionId = 1;
let pendingManualTransitions: PendingManualRecentPlayTransition[] = [];

function normalizeDuration(durationSeconds: number | null | undefined): number | null {
  return Number.isFinite(durationSeconds) && (durationSeconds ?? 0) > 0
    ? (durationSeconds ?? null)
    : null;
}

function pruneExpiredManualTransitions(nowMs: number): void {
  pendingManualTransitions = pendingManualTransitions.filter(
    (transition) => transition.expiresAtMs >= nowMs,
  );
}

export function emptyRecentPlayCandidate(): RecentPlayCandidate {
  return {
    path: null,
    durationSeconds: null,
    accumulatedMs: 0,
    playingSinceMs: null,
    recorded: false,
  };
}

export function createRecentPlayCandidate(
  path: string,
  durationSeconds: number | null | undefined,
  isPlaying: boolean,
  nowMs: number,
): RecentPlayCandidate {
  return {
    path,
    durationSeconds: normalizeDuration(durationSeconds),
    accumulatedMs: 0,
    playingSinceMs: isPlaying ? nowMs : null,
    recorded: false,
  };
}

export function withRecentPlayDuration(
  candidate: RecentPlayCandidate,
  durationSeconds: number | null | undefined,
): RecentPlayCandidate {
  const duration = normalizeDuration(durationSeconds);
  if (duration == null || duration === candidate.durationSeconds) return candidate;
  return { ...candidate, durationSeconds: duration };
}

/** Accumulates wall-clock time only while playback is actively running. */
export function advanceRecentPlayCandidate(
  candidate: RecentPlayCandidate,
  isPlaying: boolean,
  nowMs: number,
): RecentPlayCandidate {
  if (!candidate.path) return candidate;

  if (isPlaying) {
    if (candidate.playingSinceMs == null) {
      return { ...candidate, playingSinceMs: nowMs };
    }
    return {
      ...candidate,
      accumulatedMs: candidate.accumulatedMs + Math.max(0, nowMs - candidate.playingSinceMs),
      playingSinceMs: nowMs,
    };
  }

  if (candidate.playingSinceMs == null) return candidate;
  return {
    ...candidate,
    accumulatedMs: candidate.accumulatedMs + Math.max(0, nowMs - candidate.playingSinceMs),
    playingSinceMs: null,
  };
}

/**
 * Matches desktop qualification: short tracks count only at a genuine natural
 * completion, with a small bounded allowance for the final native event.
 */
export function recentPlayQualifies(
  candidate: RecentPlayCandidate,
  completedNaturally: boolean,
): boolean {
  const listenedSeconds = candidate.accumulatedMs / 1_000;
  const durationSeconds = candidate.durationSeconds;

  if (durationSeconds != null && durationSeconds < RECENT_PLAY_MIN_SECONDS) {
    if (!completedNaturally) return false;
    const toleranceSeconds = Math.min(
      SHORT_TRACK_COMPLETION_TOLERANCE_SECONDS,
      durationSeconds * SHORT_TRACK_COMPLETION_TOLERANCE_RATIO,
    );
    return listenedSeconds >= durationSeconds - toleranceSeconds;
  }

  return listenedSeconds >= RECENT_PLAY_MIN_SECONDS;
}

export function evaluateRecentPlayCandidate(
  candidate: RecentPlayCandidate,
  completedNaturally: boolean,
): RecentPlayEvaluation {
  if (!candidate.path || candidate.recorded || !recentPlayQualifies(candidate, completedNaturally)) {
    return { candidate, recordPath: null };
  }
  return {
    candidate: { ...candidate, recorded: true },
    recordPath: candidate.path,
  };
}

/** Closes the active playing span, evaluates it once, and resets for the next play. */
export function finalizeRecentPlayCandidate(
  candidate: RecentPlayCandidate,
  completedNaturally: boolean,
  nowMs: number,
  durationSeconds?: number | null,
): RecentPlayEvaluation {
  const closed = advanceRecentPlayCandidate(
    withRecentPlayDuration(candidate, durationSeconds),
    false,
    nowMs,
  );
  const evaluated = evaluateRecentPlayCandidate(closed, completedNaturally);
  return {
    candidate: emptyRecentPlayCandidate(),
    recordPath: evaluated.recordPath,
  };
}

/**
 * Marks an explicit controller transition. Tokens are matched against the
 * outgoing Astra identity path and consumed by the corresponding RNTP event.
 */
export function markManualRecentPlayTransition(
  fromPath: string | null | undefined,
  nowMs = Date.now(),
): ManualRecentPlayTransitionToken | null {
  if (!fromPath) return null;
  pruneExpiredManualTransitions(nowMs);
  const token = { id: nextManualTransitionId++ };
  pendingManualTransitions.push({
    id: token.id,
    fromPath,
    expiresAtMs: nowMs + MANUAL_RECENT_PLAY_TRANSITION_TTL_MS,
  });
  return token;
}

export function cancelManualRecentPlayTransition(
  token: ManualRecentPlayTransitionToken | null,
): void {
  if (!token) return;
  pendingManualTransitions = pendingManualTransitions.filter(
    (transition) => transition.id !== token.id,
  );
}

export function consumeManualRecentPlayTransition(
  fromPath: string | null | undefined,
  nowMs = Date.now(),
): boolean {
  pruneExpiredManualTransitions(nowMs);
  if (!fromPath) return false;
  const index = pendingManualTransitions.findIndex(
    (transition) => transition.fromPath === fromPath,
  );
  if (index < 0) return false;
  pendingManualTransitions.splice(index, 1);
  return true;
}

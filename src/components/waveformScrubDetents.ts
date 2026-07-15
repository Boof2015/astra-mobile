export const SCRUB_DETENT_SPACING_DP = 16;
export const SCRUB_TICK_MIN_INTERVAL_MS = 90;
export const SCRUB_TICK_ACTIVATION_DISTANCE_DP = 6;

export interface ScrubDetentState {
  detentIndex: number;
  lastTickAtMs: number | null;
  startPositionDp: number;
  activated: boolean;
}

export interface ScrubDetentUpdate {
  state: ScrubDetentState;
  shouldTick: boolean;
}

function clampPosition(positionDp: number, widthDp: number): number {
  if (!Number.isFinite(positionDp) || !Number.isFinite(widthDp) || widthDp <= 0) return 0;
  return Math.min(widthDp, Math.max(0, positionDp));
}

function detentIndex(positionDp: number, widthDp: number): number {
  return Math.floor(clampPosition(positionDp, widthDp) / SCRUB_DETENT_SPACING_DP);
}

/** Begin silently at the detent under the initial touch. */
export function beginScrubDetents(positionDp: number, widthDp: number): ScrubDetentState {
  const startPositionDp = clampPosition(positionDp, widthDp);
  return {
    detentIndex: detentIndex(startPositionDp, widthDp),
    lastTickAtMs: null,
    startPositionDp,
    activated: false,
  };
}

/**
 * Advance to the detent under the finger. The index always advances even when
 * rate-limited, so skipped ticks never catch up after movement stops.
 */
export function updateScrubDetents(
  state: ScrubDetentState,
  positionDp: number,
  widthDp: number,
  nowMs: number
): ScrubDetentUpdate {
  const nextPositionDp = clampPosition(positionDp, widthDp);
  const nextIndex = detentIndex(nextPositionDp, widthDp);
  const activated =
    state.activated ||
    Math.abs(nextPositionDp - state.startPositionDp) >= SCRUB_TICK_ACTIVATION_DISTANCE_DP;
  if (!activated || nextIndex === state.detentIndex) {
    return {
      state: { ...state, detentIndex: nextIndex, activated },
      shouldTick: false,
    };
  }

  const canTick =
    state.lastTickAtMs == null ||
    nowMs - state.lastTickAtMs >= SCRUB_TICK_MIN_INTERVAL_MS;

  return {
    state: {
      detentIndex: nextIndex,
      lastTickAtMs: canTick ? nowMs : state.lastTickAtMs,
      startPositionDp: state.startPositionDp,
      activated,
    },
    shouldTick: canTick,
  };
}

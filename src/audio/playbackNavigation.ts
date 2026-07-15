export const PREVIOUS_RESTART_THRESHOLD_SECONDS = 3;

/** Match desktop Astra: restart only after crossing the previous-track cutoff. */
export function shouldRestartOnPrevious(positionSeconds: number): boolean {
  return (
    Number.isFinite(positionSeconds) &&
    positionSeconds > PREVIOUS_RESTART_THRESHOLD_SECONDS
  );
}

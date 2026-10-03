// Ported from Astra desktop: src/renderer/components/player/waveformTransition.ts.
// Keep the timings and curve in sync with desktop. Every function is a worklet
// because the seek bar evaluates them per bar, per frame, on the UI thread; a
// worklet may only call worklets declared above it (see workletOrder.test.mts).

export type WaveformTransitionPhase = 'enter' | 'exit' | 'handoff';

// The activity chart spreads its bars over 220 ms. The seekbar uses the same
// left-to-right motion language in a much tighter window so 512 source bins do
// not read as a decorative traveling wave.
export const WAVEFORM_BAR_STAGGER_MS = 36;
export const WAVEFORM_ENTER_MS = 145;
export const WAVEFORM_EXIT_MS = 88;
export const WAVEFORM_HANDOFF_MS = 145;

function clampUnit(value: number): number {
  'worklet';
  return Math.min(1, Math.max(0, value));
}

function cubicBezierCoordinate(time: number, firstControl: number, secondControl: number): number {
  'worklet';
  const inverseTime = 1 - time;
  return (3 * inverseTime * inverseTime * time * firstControl)
    + (3 * inverseTime * time * time * secondControl)
    + (time * time * time);
}

// Matches Astra's --motion-structural-ease: cubic-bezier(0.22, 1, 0.36, 1).
export function easeStructural(progress: number): number {
  'worklet';
  const targetX = clampUnit(progress);
  if (targetX === 0 || targetX === 1) return targetX;

  let lowerTime = 0;
  let upperTime = 1;
  for (let iteration = 0; iteration < 8; iteration += 1) {
    const candidateTime = (lowerTime + upperTime) / 2;
    const candidateX = cubicBezierCoordinate(candidateTime, 0.22, 0.36);
    if (candidateX < targetX) lowerTime = candidateTime;
    else upperTime = candidateTime;
  }
  return cubicBezierCoordinate((lowerTime + upperTime) / 2, 1, 1);
}

function getBarDelayMs(index: number, barCount: number): number {
  'worklet';
  if (barCount <= 1) return 0;
  return (clampUnit(index / (barCount - 1))) * WAVEFORM_BAR_STAGGER_MS;
}

function getPhaseMotionMs(phase: WaveformTransitionPhase): number {
  'worklet';
  return phase === 'exit'
    ? WAVEFORM_EXIT_MS
    : phase === 'handoff'
      ? WAVEFORM_HANDOFF_MS
      : WAVEFORM_ENTER_MS;
}

export function getWaveformTransitionDurationMs(phase: WaveformTransitionPhase): number {
  'worklet';
  return getPhaseMotionMs(phase) + WAVEFORM_BAR_STAGGER_MS;
}

export function getWaveformBarScale(
  phase: WaveformTransitionPhase,
  elapsedMs: number,
  index: number,
  barCount: number,
  exitStartScale = 1,
): number {
  'worklet';
  const localElapsedMs = elapsedMs - getBarDelayMs(index, barCount);
  const easedProgress = easeStructural(localElapsedMs / getPhaseMotionMs(phase));
  if (phase !== 'exit') return easedProgress;
  return clampUnit(exitStartScale) * (1 - easedProgress);
}

export function getWaveformBaselineStrength(
  phase: WaveformTransitionPhase,
  elapsedMs: number,
): number {
  'worklet';
  const totalMs = getWaveformTransitionDurationMs(phase);
  const easedProgress = easeStructural(elapsedMs / totalMs);
  if (phase === 'handoff') return 0;
  return phase === 'enter' ? 1 - easedProgress : easedProgress;
}

export function interpolateWaveformBarHeight(
  outgoingHeight: number,
  incomingHeight: number,
  progress: number,
): number {
  'worklet';
  const interpolationProgress = clampUnit(progress);
  if (interpolationProgress === 0) return outgoingHeight;
  if (interpolationProgress === 1) return incomingHeight;
  return outgoingHeight + ((incomingHeight - outgoingHeight) * interpolationProgress);
}

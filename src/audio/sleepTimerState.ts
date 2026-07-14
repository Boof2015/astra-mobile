export const SLEEP_TIMER_PRESETS = [15, 30, 45, 60] as const;
export const MIN_SLEEP_TIMER_MINUTES = 1;
export const MAX_SLEEP_TIMER_MINUTES = 720;

export type SleepTimerMode = 'minutes' | 'end-of-track';

export interface PersistedSleepTimerState {
  mode: SleepTimerMode;
  startedAtMs: number;
  expiresAtMs: number | null;
  durationMinutes: number | null;
}

export type SleepTimerTransition =
  | { type: 'start-minutes'; minutes: number }
  | { type: 'start-end-of-track' }
  | { type: 'cancel' };

export function normalizeSleepTimerMinutes(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : Number(String(value).trim());
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed)) return null;
  if (parsed < MIN_SLEEP_TIMER_MINUTES || parsed > MAX_SLEEP_TIMER_MINUTES) return null;
  return parsed;
}

export function normalizePersistedSleepTimer(value: unknown): PersistedSleepTimerState | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const candidate = value as Partial<PersistedSleepTimerState>;
  if (candidate.mode !== 'minutes' && candidate.mode !== 'end-of-track') return null;
  if (typeof candidate.startedAtMs !== 'number' || !Number.isFinite(candidate.startedAtMs)) return null;
  if (candidate.mode === 'end-of-track') {
    return {
      mode: 'end-of-track',
      startedAtMs: candidate.startedAtMs,
      expiresAtMs: null,
      durationMinutes: null,
    };
  }
  const durationMinutes = normalizeSleepTimerMinutes(candidate.durationMinutes);
  if (durationMinutes === null || typeof candidate.expiresAtMs !== 'number' || !Number.isFinite(candidate.expiresAtMs)) {
    return null;
  }
  return {
    mode: 'minutes',
    startedAtMs: candidate.startedAtMs,
    expiresAtMs: candidate.expiresAtMs,
    durationMinutes,
  };
}

export function transitionSleepTimer(
  current: PersistedSleepTimerState | null,
  transition: SleepTimerTransition,
  nowMs: number
): PersistedSleepTimerState | null {
  void current;
  if (transition.type === 'cancel') return null;
  if (transition.type === 'start-end-of-track') {
    return { mode: 'end-of-track', startedAtMs: nowMs, expiresAtMs: null, durationMinutes: null };
  }
  const minutes = normalizeSleepTimerMinutes(transition.minutes);
  if (minutes === null) return null;
  return {
    mode: 'minutes',
    startedAtMs: nowMs,
    expiresAtMs: nowMs + minutes * 60_000,
    durationMinutes: minutes,
  };
}

export function shouldCompleteEndOfTrackTimer(
  timer: PersistedSleepTimerState | null,
  position: number,
  duration: number,
  playWhenReady: boolean
): boolean {
  return timer?.mode === 'end-of-track'
    && !playWhenReady
    && Number.isFinite(duration)
    && duration > 0
    && position >= duration - 0.75;
}

export function getSleepTimerRemainingMs(timer: PersistedSleepTimerState | null, nowMs: number): number | null {
  if (!timer || timer.mode !== 'minutes' || timer.expiresAtMs === null) return null;
  return Math.max(0, timer.expiresAtMs - nowMs);
}

export function formatSleepTimerStatus(timer: PersistedSleepTimerState | null, nowMs = Date.now()): string {
  if (!timer) return 'Off';
  if (timer.mode === 'end-of-track') return 'Ends after this track';
  const remaining = getSleepTimerRemainingMs(timer, nowMs) ?? 0;
  const totalSeconds = Math.max(0, Math.ceil(remaining / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')} remaining`
    : `${minutes}:${String(seconds).padStart(2, '0')} remaining`;
}

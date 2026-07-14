import TrackPlayer from 'react-native-track-player';
import { create } from 'zustand';
import { openLibraryDb } from '@/db/database';
import { getSetting, setSetting } from '@/db/queries';
import { setPauseAtEndOfItem } from '@/audio/trackPlayerExtensions';
import { usePlaybackTargetStore } from '@/stores/playbackTargetStore';
import {
  getSleepTimerRemainingMs,
  normalizePersistedSleepTimer,
  normalizeSleepTimerMinutes,
  shouldCompleteEndOfTrackTimer,
  transitionSleepTimer,
  type PersistedSleepTimerState,
} from '@/audio/sleepTimerState';

const SLEEP_TIMER_KEY = 'sleep_timer_state_v1';

interface SleepTimerStore {
  timer: PersistedSleepTimerState | null;
  remainingMs: number | null;
  hydrated: boolean;
  hydrate: () => Promise<void>;
  startMinutes: (minutes: number) => Promise<void>;
  startEndOfTrack: () => Promise<void>;
  cancel: () => Promise<void>;
  reconcile: (nowMs?: number) => Promise<void>;
  reconcileEndOfTrack: (position: number, duration: number, playWhenReady: boolean) => Promise<void>;
}

let deadlineTimer: ReturnType<typeof setTimeout> | null = null;
let hydrationPromise: Promise<void> | null = null;
let reconcilePromise: Promise<void> | null = null;

function clearDeadlineTimer(): void {
  if (deadlineTimer !== null) clearTimeout(deadlineTimer);
  deadlineTimer = null;
}

async function persistTimer(timer: PersistedSleepTimerState | null): Promise<void> {
  const db = await openLibraryDb();
  await setSetting(db, SLEEP_TIMER_KEY, timer ? JSON.stringify(timer) : '');
}

async function hasActivePhoneTrack(): Promise<boolean> {
  try {
    return Boolean(await TrackPlayer.getActiveTrack());
  } catch {
    return false;
  }
}

function scheduleDeadline(timer: PersistedSleepTimerState | null): void {
  clearDeadlineTimer();
  if (timer?.mode !== 'minutes' || timer.expiresAtMs === null) return;
  const delay = Math.max(0, timer.expiresAtMs - Date.now());
  deadlineTimer = setTimeout(() => {
    deadlineTimer = null;
    void useSleepTimerStore.getState().reconcile();
  }, delay);
}

async function clearCompletedTimer(expectedTimer?: PersistedSleepTimerState): Promise<void> {
  if (expectedTimer && useSleepTimerStore.getState().timer !== expectedTimer) return;
  clearDeadlineTimer();
  await setPauseAtEndOfItem(false).catch(() => {});
  if (expectedTimer && useSleepTimerStore.getState().timer !== expectedTimer) return;
  useSleepTimerStore.setState({ timer: null, remainingMs: null, hydrated: true });
  await persistTimer(null);
}

export const useSleepTimerStore = create<SleepTimerStore>((set, get) => ({
  timer: null,
  remainingMs: null,
  hydrated: false,

  hydrate: async () => {
    if (get().hydrated) return;
    if (hydrationPromise) return hydrationPromise;
    hydrationPromise = (async () => {
      const db = await openLibraryDb();
      const raw = await getSetting(db, SLEEP_TIMER_KEY);
      let parsed: unknown = null;
      try {
        parsed = raw ? JSON.parse(raw) : null;
      } catch {
        parsed = null;
      }
      const timer = normalizePersistedSleepTimer(parsed);
      const active = timer ? await hasActivePhoneTrack() : false;
      if (!timer || !active) {
        set({ timer: null, remainingMs: null, hydrated: true });
        if (raw) await persistTimer(null);
        return;
      }
      set({
        timer,
        remainingMs: getSleepTimerRemainingMs(timer, Date.now()),
        hydrated: true,
      });
      if (timer.mode === 'end-of-track') await setPauseAtEndOfItem(true);
      scheduleDeadline(timer);
      await get().reconcile();
    })().finally(() => {
      hydrationPromise = null;
    });
    return hydrationPromise;
  },

  startMinutes: async (value) => {
    const minutes = normalizeSleepTimerMinutes(value);
    if (minutes === null) throw new Error('Choose a whole number from 1 to 720 minutes.');
    if (usePlaybackTargetStore.getState().target !== 'phone') throw new Error('Sleep timers are available for phone playback only.');
    if (!await hasActivePhoneTrack()) throw new Error('Start phone playback before setting a sleep timer.');
    await setPauseAtEndOfItem(false).catch(() => {});
    const timer = transitionSleepTimer(get().timer, { type: 'start-minutes', minutes }, Date.now());
    if (!timer) throw new Error('Choose a whole number from 1 to 720 minutes.');
    set({ timer, remainingMs: minutes * 60_000, hydrated: true });
    await persistTimer(timer);
    scheduleDeadline(timer);
  },

  startEndOfTrack: async () => {
    if (usePlaybackTargetStore.getState().target !== 'phone') throw new Error('Sleep timers are available for phone playback only.');
    if (!await hasActivePhoneTrack()) throw new Error('Start phone playback before setting a sleep timer.');
    await setPauseAtEndOfItem(true);
    clearDeadlineTimer();
    const timer = transitionSleepTimer(get().timer, { type: 'start-end-of-track' }, Date.now());
    set({ timer, remainingMs: null, hydrated: true });
    await persistTimer(timer);
  },

  cancel: async () => {
    await clearCompletedTimer();
  },

  reconcile: async (nowMs = Date.now()) => {
    const timer = get().timer;
    if (!timer) return;
    if (timer.mode === 'end-of-track') return;
    const remainingMs = getSleepTimerRemainingMs(timer, nowMs) ?? 0;
    set({ remainingMs });
    if (remainingMs > 0) {
      scheduleDeadline(timer);
      return;
    }
    if (reconcilePromise) return reconcilePromise;
    reconcilePromise = (async () => {
      await TrackPlayer.pause().catch(() => {});
      await clearCompletedTimer(timer);
    })().finally(() => {
      reconcilePromise = null;
    });
    return reconcilePromise;
  },

  reconcileEndOfTrack: async (position, duration, playWhenReady) => {
    const timer = get().timer;
    if (!shouldCompleteEndOfTrackTimer(timer, position, duration, playWhenReady) || !timer) return;
    await clearCompletedTimer(timer);
  },
}));

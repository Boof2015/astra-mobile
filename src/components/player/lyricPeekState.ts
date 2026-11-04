import { applyPlaybackSnapshot, createPlaybackClock, projectPlaybackClock } from '../../audio/playbackClock.ts';
import { getActiveSyncedLyricsLine, LYRICS_DISPLAY_LEAD_MS } from '../../lyrics/presentation.ts';
import type { LyricsLine } from '../../lyrics/types.ts';

export const PEEK_ENTER_MS = 190;
export const PEEK_EXIT_MS = 160;
export const PEEK_SETTLE_GRACE_MS = 250;
export const PEEK_SLIDE_PX = 6;
const LINE_POLL_MS = 100;

/** Exactly one completion, even if native never reports finishing. Cancelling
 * the lease also rejects an already-queued native callback after slot reuse. */
export function scheduleLyricPeekCompletion(duration: number, complete: () => void, settle: () => void) {
  let live = true;
  const finish = () => {
    if (!live) return;
    live = false;
    clearTimeout(timer);
    complete();
  };
  const timer = setTimeout(() => {
    if (!live) return;
    settle();
    finish();
  }, duration + PEEK_SETTLE_GRACE_MS);
  return {
    finish,
    cancel: () => { live = false; clearTimeout(timer); },
  };
}

/** Object identity is a lease: A → B → A must not revive work from the first A. */
export interface LyricPeekSource {
  path: string;
  lines: LyricsLine[] | null;
  duration: number;
}

export interface LyricPeekSelection {
  source: LyricPeekSource;
  line: LyricsLine | null;
}

export function currentLyricPeekLine(source: LyricPeekSource, selection: LyricPeekSelection | null) {
  return selection?.source === source ? selection.line : null;
}

/** The subscription and queued initial tick share the same cancellable lease. */
export function watchLyricPeekLine({
  source, isPlaying, readPlayback, subscribe, changed,
}: {
  source: LyricPeekSource;
  isPlaying: boolean;
  readPlayback: () => { path: string | null; currentTime: number };
  subscribe: (update: () => void) => () => void;
  changed: (selection: LyricPeekSelection) => void;
}): () => void {
  let live = true;
  let clock = createPlaybackClock(readPlayback().currentTime, source.duration, isPlaying, Date.now());
  const update = () => {
    if (!live || readPlayback().path !== source.path) return;
    const time = projectPlaybackClock(clock, source.duration, Date.now());
    changed({
      source,
      line: source.lines ? getActiveSyncedLyricsLine(source.lines, time + LYRICS_DISPLAY_LEAD_MS / 1000, {
        durationSeconds: source.duration,
      }) : null,
    });
  };
  const unsubscribe = source.lines ? subscribe(() => {
    if (!live) return;
    clock = applyPlaybackSnapshot(clock, readPlayback().currentTime, source.duration, Date.now());
    update();
  }) : undefined;
  queueMicrotask(update);
  const poll = source.lines && isPlaying ? setInterval(update, LINE_POLL_MS) : null;
  return () => {
    live = false;
    unsubscribe?.();
    if (poll !== null) clearInterval(poll);
  };
}

export interface LyricPeekCue {
  line: LyricsLine;
  endMs: number | null;
}

interface LyricPeekSlot {
  cue: LyricPeekCue;
  /** Resets per-line measurements without remounting the animated frame. */
  id: number;
}

export interface LyricPeekTransition {
  source: LyricPeekSource;
  slots: [LyricPeekSlot | null, LyricPeekSlot | null];
  front: 0 | 1;
  generation: number;
  motionEnabled: boolean;
  animate: boolean;
}

export function initialLyricPeekTransition(source: LyricPeekSource): LyricPeekTransition {
  return { source, slots: [null, null], front: 0, generation: 0, motionEnabled: true, animate: false };
}

export function requestLyricPeek(
  state: LyricPeekTransition,
  source: LyricPeekSource,
  cue: LyricPeekCue | null,
  motionEnabled: boolean,
): LyricPeekTransition {
  const current = state.slots[state.front]?.cue ?? null;
  const sameCue = current?.line === cue?.line && current?.endMs === cue?.endMs;
  const reset = source !== state.source;
  const settle = !motionEnabled && state.motionEnabled;
  if (!reset && !settle && sameCue) {
    return state.motionEnabled === motionEnabled ? state : { ...state, motionEnabled };
  }

  const generation = state.generation + 1;
  const incoming = cue ? { cue, id: generation } : null;
  if (reset || !motionEnabled) {
    return { source, slots: [incoming, null], front: 0, generation, motionEnabled, animate: motionEnabled };
  }

  // Reuse the older outgoing slot, never accumulate a third line. Only the
  // previously current cue may finish exiting, including when entering a gap.
  const front = state.front === 0 ? 1 : 0;
  const slots: LyricPeekTransition['slots'] = [null, null];
  slots[state.front] = state.slots[state.front];
  slots[front] = incoming;
  return { source, slots, front, generation, motionEnabled, animate: true };
}

/** Used by native completion and the timeout backstop; stale work is harmless. */
export function releaseLyricPeekSlot(state: LyricPeekTransition, slot: number, generation: number): LyricPeekTransition {
  if (state.generation !== generation || state.front === slot || !state.slots[slot]) return state;
  const slots: LyricPeekTransition['slots'] = [...state.slots];
  slots[slot] = null;
  return { ...state, slots };
}

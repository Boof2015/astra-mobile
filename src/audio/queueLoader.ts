import TrackPlayer, { type Track as RntpTrack } from 'react-native-track-player';
import {
  cancelManualRecentPlayTransition,
  markManualRecentPlayTransition,
} from './recentPlayTracking';

/**
 * Chunked feeder for RNTP's native queue. Loading a long context in one
 * setQueue/add stalls the Android main thread for seconds (per-track Bundle →
 * Track → MediaSource construction), so playback starts from history + current
 * + eight upcoming rows and the rest streams in behind it. We never prepend:
 * native indices stay stable for the lifetime of a transport window.
 */

const INITIAL_UPCOMING = 8;
const CHUNK = 8;
const YIELD_MS = 16;

interface QueueLoad {
  generation: number;
  /** Tracks currently in the native queue (per this loader's bookkeeping). */
  loadedCount: number;
  settled: Promise<void>;
  resolveSettled: () => void;
  /** Resolves once the fill loop has stopped issuing native calls. */
  loopDone: Promise<void>;
  resolveLoopDone: () => void;
}

interface QueueLoadOptions {
  manualTransitionFromPath?: string | null;
}

let generation = 0;
let load: QueueLoad | null = null;
let onLoadError: (() => void) | null = null;

/** Recovery hook run when a background fill fails mid-way (mirror may drift). */
export function setQueueLoadErrorHandler(handler: () => void): void {
  onLoadError = handler;
}

/** Resolves when no background fill is (or remains) in flight. */
export function queueLoadSettled(): Promise<void> {
  return load ? load.settled : Promise.resolve();
}

/** RNTP and the JS transport mirror share one stable local index space. */
export function nativeIndexToAbsolute(nativeIndex: number): number {
  return nativeIndex;
}

/** Map a local mirror index to RNTP, or null until its append has landed. */
export function absoluteIndexToNative(absoluteIndex: number): number | null {
  if (!load) return absoluteIndex;
  return absoluteIndex >= 0 && absoluteIndex < load.loadedCount ? absoluteIndex : null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function supersedePreviousLoad(): Promise<number> {
  const gen = ++generation;
  const previous = load;
  // Wait the old fill loop out so none of its adds land after our first write.
  if (previous) await previous.loopDone;
  return gen;
}

function beginLoad(gen: number, loadedCount: number): QueueLoad {
  let resolveSettled!: () => void;
  let resolveLoopDone!: () => void;
  const settled = new Promise<void>((resolve) => {
    resolveSettled = resolve;
  });
  const loopDone = new Promise<void>((resolve) => {
    resolveLoopDone = resolve;
  });
  const next: QueueLoad = {
    generation: gen,
    loadedCount,
    settled,
    resolveSettled,
    loopDone,
    resolveLoopDone,
  };
  load = next;
  return next;
}

function finishLoad(current: QueueLoad, failed: boolean): void {
  current.resolveSettled();
  current.resolveLoopDone();
  if (load === current) load = null;
  if (failed) onLoadError?.();
}

/**
 * Replace the native queue with `tracks`, starting playback-ready at
 * `startIndex`. Resolves once the first chunk (containing `startIndex`) is
 * set — the caller can `play()` immediately; the rest fills in the background.
 */
export async function loadQueueChunked(
  tracks: RntpTrack[],
  startIndex: number,
  options: QueueLoadOptions = {},
): Promise<void> {
  const gen = await supersedePreviousLoad();
  if (gen !== generation) return;

  const current = beginLoad(gen, 0);
  const manualTransition = markManualRecentPlayTransition(
    options.manualTransitionFromPath,
  );
  try {
    const firstEnd = Math.min(
      tracks.length,
      Math.max(startIndex + 1, startIndex + 1 + INITIAL_UPCOMING),
    );
    const first = tracks.slice(0, firstEnd);
    await TrackPlayer.setQueue(first);
    current.loadedCount = first.length;
    if (startIndex > 0) await TrackPlayer.skip(startIndex);
  } catch (err) {
    cancelManualRecentPlayTransition(manualTransition);
    finishLoad(current, false);
    throw err;
  }

  void fillRemainder(current, tracks);
}

/**
 * Append `tracks` after the current native queue contents in chunks (tail
 * rebuilds: shuffle toggle / tray group reorders). `baseCount` is the native
 * queue length at call time (indices below it stay identity-mapped). Resolves
 * after the first chunk lands.
 */
export async function appendUpcomingChunked(tracks: RntpTrack[], baseCount: number): Promise<void> {
  const gen = await supersedePreviousLoad();
  if (gen !== generation || tracks.length === 0) return;

  const current = beginLoad(gen, baseCount);
  try {
    const first = tracks.slice(0, CHUNK);
    await TrackPlayer.add(first);
    current.loadedCount += first.length;
  } catch (err) {
    finishLoad(current, false);
    throw err;
  }

  void fillTail(current, tracks, CHUNK).then(
    () => finishLoad(current, false),
    () => finishLoad(current, true),
  );
}

/** Append tracks[fromIndex..] in chunks. Returns normally when superseded. */
async function fillTail(current: QueueLoad, tracks: RntpTrack[], fromIndex: number): Promise<void> {
  for (let i = fromIndex; i < tracks.length; i += CHUNK) {
    await sleep(YIELD_MS);
    if (current.generation !== generation) return;
    const chunk = tracks.slice(i, i + CHUNK);
    await TrackPlayer.add(chunk);
    current.loadedCount += chunk.length;
  }
}

async function fillRemainder(
  current: QueueLoad,
  tracks: RntpTrack[],
): Promise<void> {
  let failed = false;
  try {
    await fillTail(current, tracks, current.loadedCount);
  } catch {
    failed = true;
  } finally {
    finishLoad(current, failed);
  }
}

import TrackPlayer, { type Track as RntpTrack } from 'react-native-track-player';

/**
 * Chunked feeder for RNTP's native queue. Loading a long context in one
 * setQueue/add stalls the Android main thread for seconds (per-track Bundle →
 * Track → MediaSource construction), so playback starts from a small first
 * chunk and the rest streams in behind it: the upcoming tail first (it plays
 * next), then the head prepended in reverse chunk order. The JS queue mirror
 * holds the full context from the start; while the head is still missing,
 * native indices trail absolute (mirror) indices by `headRemaining`.
 */

// The first chunk's setQueue lands on the Android main thread at the exact
// moment of the play tap, so it stays tiny. Each background add() also occupies
// the main thread (= the UI thread) for time proportional to its size, so the
// chunks stay small with generous yields — a longer total fill is invisible,
// per-chunk frame drops are not.
const FIRST_CHUNK = 12;
const CHUNK = 50;
const YIELD_MS = 64;

interface QueueLoad {
  generation: number;
  /** Head tracks not yet prepended: absolute = native + headRemaining. */
  headRemaining: number;
  /** Tracks currently in the native queue (per this loader's bookkeeping). */
  loadedCount: number;
  settled: Promise<void>;
  resolveSettled: () => void;
  /** Resolves once the fill loop has stopped issuing native calls. */
  loopDone: Promise<void>;
  resolveLoopDone: () => void;
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

/** Map a native RNTP queue index to an absolute (full-queue mirror) index. */
export function nativeIndexToAbsolute(nativeIndex: number): number {
  return load ? nativeIndex + load.headRemaining : nativeIndex;
}

/**
 * Map an absolute index to its native index, or null while that part of the
 * queue has not been loaded yet.
 */
export function absoluteIndexToNative(absoluteIndex: number): number | null {
  if (!load) return absoluteIndex;
  const nativeIndex = absoluteIndex - load.headRemaining;
  return nativeIndex >= 0 && nativeIndex < load.loadedCount ? nativeIndex : null;
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

function beginLoad(gen: number, headRemaining: number, loadedCount: number): QueueLoad {
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
    headRemaining,
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
export async function loadQueueChunked(tracks: RntpTrack[], startIndex: number): Promise<void> {
  const gen = await supersedePreviousLoad();
  if (gen !== generation) return;

  const current = beginLoad(gen, startIndex, 0);
  try {
    const first = tracks.slice(startIndex, startIndex + FIRST_CHUNK);
    await TrackPlayer.setQueue(first);
    current.loadedCount = first.length;
  } catch (err) {
    finishLoad(current, false);
    throw err;
  }

  void fillRemainder(current, tracks, startIndex);
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

  const current = beginLoad(gen, 0, baseCount);
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
  startIndex: number,
): Promise<void> {
  let failed = false;
  try {
    // Tail first — it's what plays next.
    await fillTail(current, tracks, startIndex + current.loadedCount);

    // Head second, prepended in reverse chunk order so [0..startIndex) ends up
    // in original order and `absolute = native + headRemaining` holds throughout.
    for (let end = startIndex; end > 0; end -= CHUNK) {
      await sleep(YIELD_MS);
      if (current.generation !== generation) return;
      const begin = Math.max(0, end - CHUNK);
      const chunk = tracks.slice(begin, end);
      await TrackPlayer.add(chunk, 0);
      current.headRemaining = begin;
      current.loadedCount += chunk.length;
    }
  } catch {
    failed = true;
  } finally {
    finishLoad(current, failed);
  }
}

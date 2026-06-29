import TrackPlayer, {
  isPlaying,
  RepeatMode,
  type Track as RntpTrack,
} from 'react-native-track-player';
import type { Track } from '@/types/audio';
import { usePlayerStore, type RepeatMode as RepeatModeStr } from '@/stores/playerStore';
import { useQueueStore } from '@/stores/queueStore';
import { setupPlayer } from './trackPlayer';
import { SAMPLE_TRACKS, toRntpTrack } from './sampleTracks';

/**
 * Transport actions screens call. Thin wrappers over RNTP so the UI never
 * imports the engine directly — at M3/M4 this is where a custom Media3 module
 * would slot in behind the same function signatures.
 */

// Unshuffled track-id order for the active context, so shuffle can be toggled
// off and the upcoming tail restored to its original sequence (mirrors desktop's
// autoQueue + shuffledAutoIndices split, but over RNTP's flat native queue).
let originalOrder: string[] | null = null;

const NEXT_REPEAT: Record<RepeatModeStr, RepeatModeStr> = {
  none: 'all',
  all: 'one',
  one: 'none',
};

function toRntpRepeat(mode: RepeatModeStr): RepeatMode {
  switch (mode) {
    case 'one':
      return RepeatMode.Track;
    case 'all':
      return RepeatMode.Queue;
    default:
      return RepeatMode.Off;
  }
}

function rntpTrackId(track: RntpTrack): string {
  return String(track.id ?? track.url);
}

async function getQueueSnapshot(): Promise<{ queue: RntpTrack[]; activeIndex: number }> {
  const store = useQueueStore.getState();
  const activeIndex = (await TrackPlayer.getActiveTrackIndex()) ?? -1;

  if (store.hasSnapshot) {
    store.setActiveIndex(activeIndex);
    return { queue: useQueueStore.getState().tracks, activeIndex };
  }

  const queue = await TrackPlayer.getQueue();
  store.setSnapshot(queue, activeIndex);
  return { queue, activeIndex };
}

async function refreshActiveIndexFromNative(): Promise<void> {
  await useQueueStore.getState().refreshActiveIndex();
}

function syncOriginalOrderFromMirrorIfUnshuffled(): void {
  if (usePlayerStore.getState().shuffle) return;
  const { tracks, hasSnapshot } = useQueueStore.getState();
  if (hasSnapshot) originalOrder = tracks.map(rntpTrackId);
}

/** Fisher–Yates shuffle a copy of the array. */
function shuffleArray<T>(items: readonly T[]): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * Set up the player. Setup is deferred to here (a user-initiated play) rather
 * than app launch: RNTP starts a foreground MediaSession service on setup, and
 * Android only permits starting a foreground service while the app is in the
 * foreground. The stored repeat mode is re-applied after a (re)setup so a
 * deferred init keeps the user's choice.
 */
async function ensurePlayerReady(options: { allowBackgroundSetup?: boolean } = {}): Promise<void> {
  await setupPlayer(options);
  await TrackPlayer.setRepeatMode(toRntpRepeat(usePlayerStore.getState().repeat));
}

/** Replace the queue with the given tracks and start playing at startIndex. */
export async function playTracks(tracks: Track[], startIndex = 0): Promise<void> {
  return playTracksInternal(tracks, startIndex, { allowBackgroundSetup: false });
}

/** Android Auto can request playback while the React UI is not foregrounded. */
export async function playTracksForCar(tracks: Track[], startIndex = 0): Promise<void> {
  return playTracksInternal(tracks, startIndex, { allowBackgroundSetup: true });
}

async function playTracksInternal(
  tracks: Track[],
  startIndex: number,
  options: { allowBackgroundSetup: boolean },
): Promise<void> {
  if (tracks.length === 0) return;
  await ensurePlayerReady(options);
  const queueTracks = tracks.map(toRntpTrack);
  await TrackPlayer.setQueue(queueTracks);
  originalOrder = tracks.map((t) => t.id);
  if (startIndex > 0) {
    await TrackPlayer.skip(startIndex);
  }
  let mirroredQueue = queueTracks;
  // Honor an already-on shuffle by scrambling the upcoming tail of the new context.
  if (usePlayerStore.getState().shuffle) {
    const upcoming = tracks.slice(startIndex + 1);
    if (upcoming.length > 1) {
      const shuffledUpcoming = shuffleArray(upcoming).map(toRntpTrack);
      await TrackPlayer.removeUpcomingTracks();
      await TrackPlayer.add(shuffledUpcoming);
      mirroredQueue = [...queueTracks.slice(0, startIndex + 1), ...shuffledUpcoming];
    }
  }
  useQueueStore.getState().setSnapshot(mirroredQueue, startIndex);
  await TrackPlayer.play();
}

/** Shuffle a context and play from the top (the library/album "Shuffle" buttons). */
export async function shuffleTracks(tracks: Track[]): Promise<void> {
  if (tracks.length === 0) return;
  await ensurePlayerReady();
  originalOrder = tracks.map((t) => t.id);
  usePlayerStore.getState().setShuffle(true);
  const queueTracks = shuffleArray(tracks).map(toRntpTrack);
  await TrackPlayer.setQueue(queueTracks);
  useQueueStore.getState().setSnapshot(queueTracks, 0);
  await TrackPlayer.play();
}

/** M0 demo entry point: load the streamed sample queue if nothing is queued. */
export async function playSample(): Promise<void> {
  await ensurePlayerReady();
  const queue = await TrackPlayer.getQueue();
  if (queue.length === 0) {
    const sampleQueue = SAMPLE_TRACKS.map(toRntpTrack);
    await TrackPlayer.add(sampleQueue);
    originalOrder = SAMPLE_TRACKS.map((t) => t.id);
    useQueueStore.getState().setSnapshot(sampleQueue, 0);
  } else {
    const activeIndex = await TrackPlayer.getActiveTrackIndex();
    useQueueStore.getState().setSnapshot(queue, activeIndex);
  }
  await TrackPlayer.play();
}

export const play = (): Promise<void> => TrackPlayer.play();
export async function playForCar(): Promise<void> {
  await ensurePlayerReady({ allowBackgroundSetup: true });
  await TrackPlayer.play();
}
export const pause = (): Promise<void> => TrackPlayer.pause();
export const seekTo = (seconds: number): Promise<void> => TrackPlayer.seekTo(seconds);

export async function togglePlay(): Promise<void> {
  const { playing } = await isPlaying();
  if (playing) {
    await TrackPlayer.pause();
  } else {
    await ensurePlayerReady();
    await TrackPlayer.play();
  }
}

export async function skipToNext(): Promise<void> {
  try {
    await TrackPlayer.skipToNext();
    await refreshActiveIndexFromNative();
  } catch {
    // no next track — ignore
  }
}

export async function skipToPrevious(): Promise<void> {
  try {
    await TrackPlayer.skipToPrevious();
    await refreshActiveIndexFromNative();
  } catch {
    // no previous track — ignore
  }
}

/** Cycle repeat none → all → one (desktop order) and push it to RNTP. */
export async function cycleRepeat(): Promise<void> {
  const next = NEXT_REPEAT[usePlayerStore.getState().repeat];
  usePlayerStore.getState().setRepeat(next);
  await ensurePlayerReady();
  await TrackPlayer.setRepeatMode(toRntpRepeat(next));
}

/**
 * Toggle shuffle. The current track keeps playing untouched (no audio gap); only
 * the upcoming tail is re-ordered: scrambled when turning on, restored to
 * `originalOrder` when turning off.
 */
export async function toggleShuffle(): Promise<void> {
  const store = usePlayerStore.getState();
  const next = !store.shuffle;
  await ensurePlayerReady();

  const snapshot = await getQueueSnapshot();
  const queue = snapshot.queue;
  const activeIndex = snapshot.activeIndex >= 0 ? snapshot.activeIndex : 0;
  let mirroredQueue = queue;

  if (next) {
    if (originalOrder === null) originalOrder = queue.map(rntpTrackId);
    const upcoming = queue.slice(activeIndex + 1);
    if (upcoming.length > 1) {
      const shuffledUpcoming = shuffleArray(upcoming);
      await TrackPlayer.removeUpcomingTracks();
      await TrackPlayer.add(shuffledUpcoming);
      mirroredQueue = [...queue.slice(0, activeIndex + 1), ...shuffledUpcoming];
    }
  } else if (originalOrder) {
    const byId = new Map(queue.map((t) => [rntpTrackId(t), t]));
    const currentId = queue[activeIndex] ? rntpTrackId(queue[activeIndex]) : null;
    const origPos = currentId ? originalOrder.indexOf(currentId) : -1;
    const restoredIds = origPos >= 0 ? originalOrder.slice(origPos + 1) : originalOrder;
    const restored = restoredIds
      .map((id) => byId.get(id))
      .filter((t): t is RntpTrack => Boolean(t));
    await TrackPlayer.removeUpcomingTracks();
    if (restored.length) await TrackPlayer.add(restored);
    mirroredQueue = [...queue.slice(0, activeIndex + 1), ...restored];
  }

  useQueueStore.getState().setSnapshot(mirroredQueue, activeIndex);
  store.setShuffle(next);
}

/** Insert a track right after the current one ("Play next"). */
export async function enqueueTop(track: Track): Promise<void> {
  await ensurePlayerReady();
  const activeIndex = await TrackPlayer.getActiveTrackIndex();
  const activeTrack = await TrackPlayer.getActiveTrack();
  const insertBefore = activeIndex === undefined ? undefined : activeIndex + 1;
  const queueTrack = toRntpTrack(track);
  await TrackPlayer.add(queueTrack, insertBefore);
  if (useQueueStore.getState().hasSnapshot) {
    useQueueStore.getState().insertTrack(queueTrack, insertBefore);
  } else {
    await useQueueStore.getState().refreshFromNative();
  }
  if (originalOrder) {
    const currentId = activeTrack ? rntpTrackId(activeTrack) : null;
    const pos = currentId ? originalOrder.indexOf(currentId) : -1;
    if (pos >= 0) originalOrder.splice(pos + 1, 0, track.id);
    else originalOrder.unshift(track.id);
  }
}

/** Append a track to the end of the queue ("Add to queue"). */
export async function enqueueEnd(track: Track): Promise<void> {
  await ensurePlayerReady();
  const queueTrack = toRntpTrack(track);
  await TrackPlayer.add(queueTrack);
  if (useQueueStore.getState().hasSnapshot) {
    useQueueStore.getState().insertTrack(queueTrack);
  } else {
    await useQueueStore.getState().refreshFromNative();
  }
  if (originalOrder) originalOrder.push(track.id);
}

// ── Queue-tray operations ────────────────────────────────────────────────────
// The tray works in absolute RNTP queue indices. Single-item reorders use
// RNTP's native move; group operations rebuild the upcoming tail so the current
// track never stops.

function moveOriginalOrderIfUnshuffled(fromIndex: number, toIndex: number): void {
  if (usePlayerStore.getState().shuffle || originalOrder === null) return;
  if (fromIndex < 0 || fromIndex >= originalOrder.length) return;
  const [moved] = originalOrder.splice(fromIndex, 1);
  const boundedTo = Math.max(0, Math.min(originalOrder.length, toIndex));
  originalOrder.splice(boundedTo, 0, moved);
}

/** Replace everything after the current track with `upcoming` (in order). */
export async function setUpcoming(upcoming: RntpTrack[]): Promise<void> {
  await TrackPlayer.removeUpcomingTracks();
  if (upcoming.length) await TrackPlayer.add(upcoming);
  useQueueStore.getState().replaceUpcoming(upcoming);
  syncOriginalOrderFromMirrorIfUnshuffled();
}

/** Move a queued item by absolute RNTP queue index. */
export async function moveQueueItem(fromAbsoluteIndex: number, toAbsoluteIndex: number): Promise<void> {
  if (fromAbsoluteIndex === toAbsoluteIndex) return;
  await TrackPlayer.move(fromAbsoluteIndex, toAbsoluteIndex);
  useQueueStore.getState().moveItem(fromAbsoluteIndex, toAbsoluteIndex);
  moveOriginalOrderIfUnshuffled(fromAbsoluteIndex, toAbsoluteIndex);
}

/** Jump to (and play) an absolute queue index. */
export async function jumpToQueueIndex(index: number): Promise<void> {
  await TrackPlayer.skip(index);
  useQueueStore.getState().setActiveIndex(index);
  await TrackPlayer.play();
}

async function getUpcoming(): Promise<{ activeIndex: number; upcoming: RntpTrack[] }> {
  const { queue, activeIndex: active } = await getQueueSnapshot();
  const activeIndex = active >= 0 ? active : -1;
  return { activeIndex, upcoming: queue.slice(activeIndex + 1) };
}

/** Move an upcoming track (absolute index) to the front of the upcoming queue. */
export async function requeueToTop(absoluteIndex: number): Promise<void> {
  const { activeIndex, upcoming } = await getUpcoming();
  const local = absoluteIndex - (activeIndex + 1);
  if (local < 0 || local >= upcoming.length) return;
  const [moved] = upcoming.splice(local, 1);
  upcoming.unshift(moved);
  await setUpcoming(upcoming);
}

/** Move a group of upcoming tracks (absolute indices) to the front, order kept. */
export async function requeueManyToTop(absoluteIndices: number[]): Promise<void> {
  const { activeIndex, upcoming } = await getUpcoming();
  const locals = new Set(absoluteIndices.map((i) => i - (activeIndex + 1)));
  const moved = upcoming.filter((_, i) => locals.has(i));
  const rest = upcoming.filter((_, i) => !locals.has(i));
  await setUpcoming([...moved, ...rest]);
}

/** Remove a single track at an absolute queue index. */
export async function removeFromQueue(absoluteIndex: number): Promise<void> {
  await TrackPlayer.remove(absoluteIndex);
  useQueueStore.getState().removeIndices([absoluteIndex]);
  syncOriginalOrderFromMirrorIfUnshuffled();
}

/** Remove a group of tracks at absolute queue indices. */
export async function removeManyFromQueue(absoluteIndices: number[]): Promise<void> {
  if (absoluteIndices.length === 0) return;
  await TrackPlayer.remove(absoluteIndices);
  useQueueStore.getState().removeIndices(absoluteIndices);
  syncOriginalOrderFromMirrorIfUnshuffled();
}

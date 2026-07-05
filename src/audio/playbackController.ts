import TrackPlayer, {
  RepeatMode,
  State,
  type Track as RntpTrack,
} from 'react-native-track-player';
import type { PlaybackState, Track } from '@/types/audio';
import { usePlayerStore, type RepeatMode as RepeatModeStr } from '@/stores/playerStore';
import { useQueueStore } from '@/stores/queueStore';
import { setupPlayer } from './trackPlayer';
import { SAMPLE_TRACKS, rntpToTrack, toRntpTrack } from './sampleTracks';
import {
  absoluteIndexToNative,
  appendUpcomingChunked,
  loadQueueChunked,
  queueLoadSettled,
  setQueueLoadErrorHandler,
} from './queueLoader';

// If a background queue fill dies partway, the mirror no longer matches the
// native queue — re-read the truth.
setQueueLoadErrorHandler(() => {
  void useQueueStore.getState().refreshFromNative();
});

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

function mapRntpState(state?: State): PlaybackState {
  switch (state) {
    case State.Playing:
      return 'playing';
    case State.Buffering:
    case State.Loading:
      return 'loading';
    case State.Paused:
    case State.Ready:
      return 'paused';
    default:
      return 'stopped';
  }
}

function rntpTrackId(track: RntpTrack): string {
  return String(track.id ?? track.url);
}

function setOptimisticTrack(track: RntpTrack | undefined, playbackState?: PlaybackState): void {
  if (!track) return;
  const current = rntpToTrack(track);
  const player = usePlayerStore.getState();
  player.setCurrentTrack(current);
  player.setProgress(0, current.duration);
  player.clearPendingSeek();
  if (playbackState) player.setPlaybackState(playbackState);
}

async function reconcilePlayerFromNative(): Promise<void> {
  try {
    const [activeTrack, playbackState, progress] = await Promise.all([
      TrackPlayer.getActiveTrack(),
      TrackPlayer.getPlaybackState(),
      TrackPlayer.getProgress(),
    ]);
    const player = usePlayerStore.getState();
    player.setCurrentTrack(activeTrack ? rntpToTrack(activeTrack) : null);
    player.setPlaybackState(mapRntpState(playbackState.state));
    player.setProgress(progress.position, progress.duration);
    player.clearPendingSeek();
  } catch {
    // PlaybackSync will reconcile on the next native event/tick.
  }
}

async function getQueueSnapshot(): Promise<{ queue: RntpTrack[]; activeIndex: number }> {
  const store = useQueueStore.getState();

  if (store.hasSnapshot) {
    await store.refreshActiveIndex();
    const { tracks, activeIndex } = useQueueStore.getState();
    return { queue: tracks, activeIndex };
  }

  await store.refreshFromNative();
  const { tracks, activeIndex } = useQueueStore.getState();
  return { queue: tracks, activeIndex };
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
  originalOrder = tracks.map((t) => t.id);
  // Honor an already-on shuffle by scrambling the upcoming tail of the new
  // context up front, so the whole queue is loaded natively in a single pass.
  let ordered = tracks;
  if (usePlayerStore.getState().shuffle && tracks.length - startIndex - 1 > 1) {
    ordered = [...tracks.slice(0, startIndex + 1), ...shuffleArray(tracks.slice(startIndex + 1))];
  }
  const queueTracks = ordered.map(toRntpTrack);
  useQueueStore.getState().setSnapshot(queueTracks, startIndex);
  setOptimisticTrack(queueTracks[startIndex], 'loading');
  try {
    await loadQueueChunked(queueTracks, startIndex);
    await TrackPlayer.play();
    usePlayerStore.getState().setPlaybackState('playing');
  } catch (err) {
    await reconcilePlayerFromNative();
    throw err;
  }
}

/** Shuffle a context and play from the top (the library/album "Shuffle" buttons). */
export async function shuffleTracks(tracks: Track[]): Promise<void> {
  if (tracks.length === 0) return;
  await ensurePlayerReady();
  originalOrder = tracks.map((t) => t.id);
  usePlayerStore.getState().setShuffle(true);
  const queueTracks = shuffleArray(tracks).map(toRntpTrack);
  useQueueStore.getState().setSnapshot(queueTracks, 0);
  setOptimisticTrack(queueTracks[0], 'loading');
  try {
    await loadQueueChunked(queueTracks, 0);
    await TrackPlayer.play();
    usePlayerStore.getState().setPlaybackState('playing');
  } catch (err) {
    await reconcilePlayerFromNative();
    throw err;
  }
}

/** M0 demo entry point: load the streamed sample queue if nothing is queued. */
export async function playSample(): Promise<void> {
  await ensurePlayerReady();
  await queueLoadSettled();
  const queue = await TrackPlayer.getQueue();
  if (queue.length === 0) {
    const sampleQueue = SAMPLE_TRACKS.map(toRntpTrack);
    await TrackPlayer.add(sampleQueue);
    originalOrder = SAMPLE_TRACKS.map((t) => t.id);
    useQueueStore.getState().setSnapshot(sampleQueue, 0);
    setOptimisticTrack(sampleQueue[0], 'loading');
  } else {
    const activeIndex = await TrackPlayer.getActiveTrackIndex();
    useQueueStore.getState().setSnapshot(queue, activeIndex);
    setOptimisticTrack(queue[activeIndex ?? 0], 'loading');
  }
  try {
    await TrackPlayer.play();
    usePlayerStore.getState().setPlaybackState('playing');
  } catch (err) {
    await reconcilePlayerFromNative();
    throw err;
  }
}

export async function play(): Promise<void> {
  usePlayerStore.getState().setPlaybackState('playing');
  try {
    await TrackPlayer.play();
  } catch (err) {
    await reconcilePlayerFromNative();
    throw err;
  }
}
export async function playForCar(): Promise<void> {
  await ensurePlayerReady({ allowBackgroundSetup: true });
  await play();
}
export async function pause(): Promise<void> {
  usePlayerStore.getState().setPlaybackState('paused');
  try {
    await TrackPlayer.pause();
  } catch (err) {
    await reconcilePlayerFromNative();
    throw err;
  }
}

export async function seekTo(seconds: number): Promise<void> {
  const duration = usePlayerStore.getState().duration;
  usePlayerStore.getState().setPendingSeek(seconds);
  usePlayerStore.getState().setProgress(seconds, duration);
  try {
    await TrackPlayer.seekTo(seconds);
  } catch (err) {
    usePlayerStore.getState().clearPendingSeek();
    await reconcilePlayerFromNative();
    throw err;
  }
}

export async function togglePlay(): Promise<void> {
  const playing = usePlayerStore.getState().playbackState === 'playing';
  if (playing) {
    await pause();
  } else {
    await ensurePlayerReady();
    await play();
  }
}

export async function skipToNext(): Promise<void> {
  const { tracks, activeIndex } = useQueueStore.getState();
  const nextIndex = activeIndex >= 0 ? activeIndex + 1 : -1;
  if (nextIndex >= 0 && nextIndex < tracks.length) {
    useQueueStore.getState().setActiveIndex(nextIndex);
    setOptimisticTrack(tracks[nextIndex], usePlayerStore.getState().playbackState);
  }
  try {
    await TrackPlayer.skipToNext();
    await refreshActiveIndexFromNative();
  } catch {
    await reconcilePlayerFromNative();
    // no next track — ignore
  }
}

export async function skipToPrevious(): Promise<void> {
  const { tracks, activeIndex } = useQueueStore.getState();
  const previousIndex = activeIndex > 0 ? activeIndex - 1 : -1;
  if (previousIndex >= 0 && previousIndex < tracks.length) {
    useQueueStore.getState().setActiveIndex(previousIndex);
    setOptimisticTrack(tracks[previousIndex], usePlayerStore.getState().playbackState);
  }
  try {
    await TrackPlayer.skipToPrevious();
    await refreshActiveIndexFromNative();
  } catch {
    await reconcilePlayerFromNative();
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
  await queueLoadSettled();

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
      await appendUpcomingChunked(shuffledUpcoming, activeIndex + 1);
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
    if (restored.length) await appendUpcomingChunked(restored, activeIndex + 1);
    mirroredQueue = [...queue.slice(0, activeIndex + 1), ...restored];
  }

  useQueueStore.getState().setSnapshot(mirroredQueue, activeIndex);
  store.setShuffle(next);
}

/** Insert a track right after the current one ("Play next"). */
export async function enqueueTop(track: Track): Promise<void> {
  await ensurePlayerReady();
  await queueLoadSettled();
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
  await queueLoadSettled();
  const queueTrack = toRntpTrack(track);
  await TrackPlayer.add(queueTrack);
  if (useQueueStore.getState().hasSnapshot) {
    useQueueStore.getState().insertTrack(queueTrack);
  } else {
    await useQueueStore.getState().refreshFromNative();
  }
  if (originalOrder) originalOrder.push(track.id);
}

/** Insert tracks after the current one in the given order (batch "Play next"). */
export async function enqueueTopMany(tracks: Track[]): Promise<void> {
  if (tracks.length === 0) return;
  await ensurePlayerReady();
  await queueLoadSettled();
  const activeIndex = await TrackPlayer.getActiveTrackIndex();
  const activeTrack = await TrackPlayer.getActiveTrack();
  const insertBefore = activeIndex === undefined ? undefined : activeIndex + 1;
  await TrackPlayer.add(tracks.map(toRntpTrack), insertBefore);
  // One settle-gated native read keeps the mirror consistent for any batch size.
  await useQueueStore.getState().refreshFromNative();
  if (originalOrder) {
    const currentId = activeTrack ? rntpTrackId(activeTrack) : null;
    const pos = currentId ? originalOrder.indexOf(currentId) : -1;
    const ids = tracks.map((track) => track.id);
    if (pos >= 0) originalOrder.splice(pos + 1, 0, ...ids);
    else originalOrder.unshift(...ids);
  }
}

/** Append tracks to the end of the queue in the given order (batch "Add to queue"). */
export async function enqueueEndMany(tracks: Track[]): Promise<void> {
  if (tracks.length === 0) return;
  await ensurePlayerReady();
  await queueLoadSettled();
  await TrackPlayer.add(tracks.map(toRntpTrack));
  await useQueueStore.getState().refreshFromNative();
  if (originalOrder) originalOrder.push(...tracks.map((track) => track.id));
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
  await queueLoadSettled();
  await TrackPlayer.removeUpcomingTracks();
  useQueueStore.getState().replaceUpcoming(upcoming);
  if (upcoming.length) {
    const { activeIndex } = useQueueStore.getState();
    await appendUpcomingChunked(upcoming, activeIndex >= 0 ? activeIndex + 1 : 0);
  }
  syncOriginalOrderFromMirrorIfUnshuffled();
}

/** Move a queued item by absolute RNTP queue index. */
export async function moveQueueItem(fromAbsoluteIndex: number, toAbsoluteIndex: number): Promise<void> {
  if (fromAbsoluteIndex === toAbsoluteIndex) return;
  await queueLoadSettled();
  await TrackPlayer.move(fromAbsoluteIndex, toAbsoluteIndex);
  useQueueStore.getState().moveItem(fromAbsoluteIndex, toAbsoluteIndex);
  moveOriginalOrderIfUnshuffled(fromAbsoluteIndex, toAbsoluteIndex);
}

/** Jump to (and play) an absolute queue index. */
export async function jumpToQueueIndex(index: number): Promise<void> {
  // Mid-fill, the tapped row may not be in the native queue yet (or may sit at
  // a shifted native index while the head is still prepending) — translate,
  // waiting out the fill only when the target isn't loaded.
  const queuedTrack = useQueueStore.getState().tracks[index];
  useQueueStore.getState().setActiveIndex(index);
  setOptimisticTrack(queuedTrack, 'playing');
  let nativeIndex = absoluteIndexToNative(index);
  while (nativeIndex == null) {
    await queueLoadSettled();
    nativeIndex = absoluteIndexToNative(index);
  }
  try {
    await TrackPlayer.skip(nativeIndex);
    useQueueStore.getState().setActiveIndex(index);
    await TrackPlayer.play();
    usePlayerStore.getState().setPlaybackState('playing');
  } catch (err) {
    await reconcilePlayerFromNative();
    throw err;
  }
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
  await queueLoadSettled();
  await TrackPlayer.remove(absoluteIndex);
  useQueueStore.getState().removeIndices([absoluteIndex]);
  syncOriginalOrderFromMirrorIfUnshuffled();
}

/** Remove a group of tracks at absolute queue indices. */
export async function removeManyFromQueue(absoluteIndices: number[]): Promise<void> {
  if (absoluteIndices.length === 0) return;
  await queueLoadSettled();
  await TrackPlayer.remove(absoluteIndices);
  useQueueStore.getState().removeIndices(absoluteIndices);
  syncOriginalOrderFromMirrorIfUnshuffled();
}

import TrackPlayer, {
  RepeatMode,
  State,
  type Track as RntpTrack,
} from 'react-native-track-player';
import type { PlaybackState, Track } from '@/types/audio';
import { usePlayerStore, type RepeatMode as RepeatModeStr } from '@/stores/playerStore';
import { useQueueStore } from '@/stores/queueStore';
import { usePlaybackTargetStore } from '@/stores/playbackTargetStore';
import type {
  PlaybackSessionSnapshotV1,
  ResolvedPlaybackSession,
} from '@/session/sessionState';
import { materializePlaybackQueue } from '@/session/playbackMaterialization';
import { setupPlayer } from './trackPlayer';
import { SAMPLE_TRACKS, rntpToTrack, toRntpTrack } from './sampleTracks';
import {
  absoluteIndexToNative,
  appendUpcomingChunked,
  loadQueueChunked,
  queueLoadSettled,
  setQueueLoadErrorHandler,
} from './queueLoader';
import {
  dspTargetFromTrack,
  prepareAudioProcessingForPlayback,
  primePreparedTrackForPlayback,
} from './audioProcessingStartup';
import { shouldRestartOnPrevious } from './playbackNavigation';

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
let restoredMaterializationPromise: Promise<void> | null = null;

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

function rntpTrackPath(track: RntpTrack): string {
  return typeof track.astraPath === 'string' ? track.astraPath : String(track.url);
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
    if (usePlayerStore.getState().restoredSessionPending) {
      return { queue: store.tracks, activeIndex: store.activeIndex };
    }
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

function pruneOriginalOrderToMirror(): void {
  if (!originalOrder) return;
  const remaining = new Map<string, number>();
  for (const track of useQueueStore.getState().tracks) {
    const id = rntpTrackId(track);
    remaining.set(id, (remaining.get(id) ?? 0) + 1);
  }
  originalOrder = originalOrder.filter((id) => {
    const count = remaining.get(id) ?? 0;
    if (count <= 0) return false;
    if (count === 1) remaining.delete(id);
    else remaining.set(id, count - 1);
    return true;
  });
}

function selectPhonePlaybackTarget(): void {
  void usePlaybackTargetStore.getState().setTarget('phone');
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
async function materializeRestoredSession(): Promise<void> {
  if (!usePlayerStore.getState().restoredSessionPending) return;
  if (restoredMaterializationPromise) return restoredMaterializationPromise;

  restoredMaterializationPromise = (async () => {
    const queue = useQueueStore.getState();
    if (queue.tracks.length === 0 || queue.activeIndex < 0) {
      usePlayerStore.getState().setRestoredSessionPending(false);
      return;
    }

    const player = usePlayerStore.getState();
    // Remote stream URLs can expire or the server can move between relaunch and
    // Play. Rebuild every RNTP row from its stable Astra identity at the lazy
    // materialization boundary so URL resolution is fresh.
    const materializedTracks = queue.tracks.map((track) => toRntpTrack(rntpToTrack(track)));
    useQueueStore.getState().setSnapshot(materializedTracks, queue.activeIndex);
    if (player.currentTime > 0) player.setPendingSeek(player.currentTime);
    await materializePlaybackQueue(
      {
        tracks: materializedTracks,
        activeIndex: queue.activeIndex,
        position: player.currentTime,
        repeat: player.repeat,
      },
      {
        loadQueue: loadQueueChunked,
        setRepeat: async (repeat) => {
          await TrackPlayer.setRepeatMode(toRntpRepeat(repeat));
        },
        seek: (position) => TrackPlayer.seekTo(position),
      }
    );
    usePlayerStore.getState().setRestoredSessionPending(false);
  })();

  try {
    await restoredMaterializationPromise;
  } finally {
    restoredMaterializationPromise = null;
  }
}

async function ensurePlayerReady(
  options: { allowBackgroundSetup?: boolean; materializeRestored?: boolean } = {}
): Promise<void> {
  await setupPlayer(options);
  if (options.materializeRestored !== false) await materializeRestoredSession();
  await TrackPlayer.setRepeatMode(toRntpRepeat(usePlayerStore.getState().repeat));
}

function discardPendingRestoredSession(): void {
  usePlayerStore.getState().setRestoredSessionPending(false);
}

export function getPlaybackSessionSnapshot(): PlaybackSessionSnapshotV1 | null {
  const queue = useQueueStore.getState();
  if (!queue.hasSnapshot || queue.tracks.length === 0) return null;

  const player = usePlayerStore.getState();
  const queuePaths = queue.tracks.map(rntpTrackPath);
  let activeIndex = queue.activeIndex;
  if (activeIndex < 0 || activeIndex >= queuePaths.length) {
    const currentPath = player.currentTrack?.path;
    activeIndex = currentPath ? queuePaths.indexOf(currentPath) : -1;
    if (activeIndex < 0) activeIndex = 0;
  }

  const pathById = new Map(queue.tracks.map((track) => [rntpTrackId(track), rntpTrackPath(track)]));
  const originalOrderPaths = originalOrder
    ?.map((id) => pathById.get(id))
    .filter((path): path is string => Boolean(path));

  return {
    queuePaths,
    activeIndex,
    position: player.currentTime,
    shuffle: player.shuffle,
    repeat: player.repeat,
    originalOrderPaths: originalOrderPaths?.length === queuePaths.length
      ? originalOrderPaths
      : [...queuePaths],
  };
}

export function restorePlaybackSession(
  session: ResolvedPlaybackSession<Track> | null
): void {
  const player = usePlayerStore.getState();
  if (!session || session.tracks.length === 0) {
    originalOrder = null;
    useQueueStore.getState().setSnapshot([], -1);
    player.reset();
    player.setShuffle(false);
    player.setRepeat('none');
    return;
  }

  const queueTracks = session.tracks.map(toRntpTrack);
  const activeTrack = session.tracks[session.activeIndex];
  const idByPath = new Map(session.tracks.map((track) => [track.path, track.id]));
  originalOrder = session.originalOrderPaths
    .map((path) => idByPath.get(path))
    .filter((id): id is string => Boolean(id));
  useQueueStore.getState().setSnapshot(queueTracks, session.activeIndex);
  player.setCurrentTrack(activeTrack);
  player.setProgress(session.position, activeTrack.duration);
  player.clearPendingSeek();
  player.setShuffle(session.shuffle);
  player.setRepeat(session.repeat);
  player.setPlaybackState('paused');
  player.setRestoredSessionPending(true);
}

/** A live RNTP session (for example Android Auto) wins over an older disk snapshot. */
export async function hasActiveNativePlaybackSession(): Promise<boolean> {
  try {
    return Boolean(await TrackPlayer.getActiveTrack());
  } catch {
    return false;
  }
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
  selectPhonePlaybackTarget();
  discardPendingRestoredSession();
  await ensurePlayerReady({ ...options, materializeRestored: false });
  originalOrder = tracks.map((t) => t.id);
  // Honor an already-on shuffle by scrambling the upcoming tail of the new
  // context up front, so the whole queue is loaded natively in a single pass.
  let ordered = tracks;
  if (usePlayerStore.getState().shuffle && tracks.length - startIndex - 1 > 1) {
    ordered = [...tracks.slice(0, startIndex + 1), ...shuffleArray(tracks.slice(startIndex + 1))];
  }
  const queueTracks = ordered.map(toRntpTrack);
  const playbackTarget = dspTargetFromTrack(queueTracks[startIndex], 'none');
  useQueueStore.getState().setSnapshot(queueTracks, startIndex);
  setOptimisticTrack(queueTracks[startIndex], 'loading');
  try {
    await prepareAudioProcessingForPlayback(playbackTarget, 'queue-play');
    await loadQueueChunked(queueTracks, startIndex);
    await primePreparedTrackForPlayback(playbackTarget, 'queue-play');
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
  selectPhonePlaybackTarget();
  discardPendingRestoredSession();
  await ensurePlayerReady({ materializeRestored: false });
  originalOrder = tracks.map((t) => t.id);
  usePlayerStore.getState().setShuffle(true);
  const queueTracks = shuffleArray(tracks).map(toRntpTrack);
  const playbackTarget = dspTargetFromTrack(queueTracks[0], 'none');
  useQueueStore.getState().setSnapshot(queueTracks, 0);
  setOptimisticTrack(queueTracks[0], 'loading');
  try {
    await prepareAudioProcessingForPlayback(playbackTarget, 'shuffle-play');
    await loadQueueChunked(queueTracks, 0);
    await primePreparedTrackForPlayback(playbackTarget, 'shuffle-play');
    await TrackPlayer.play();
    usePlayerStore.getState().setPlaybackState('playing');
  } catch (err) {
    await reconcilePlayerFromNative();
    throw err;
  }
}

/** M0 demo entry point: load the streamed sample queue if nothing is queued. */
export async function playSample(): Promise<void> {
  selectPhonePlaybackTarget();
  discardPendingRestoredSession();
  await ensurePlayerReady({ materializeRestored: false });
  await queueLoadSettled();
  const queue = await TrackPlayer.getQueue();
  let playbackTarget: ReturnType<typeof dspTargetFromTrack>;
  if (queue.length === 0) {
    const sampleQueue = SAMPLE_TRACKS.map(toRntpTrack);
    playbackTarget = dspTargetFromTrack(sampleQueue[0], 'none');
    await prepareAudioProcessingForPlayback(playbackTarget, 'sample-play');
    await TrackPlayer.add(sampleQueue);
    originalOrder = SAMPLE_TRACKS.map((t) => t.id);
    useQueueStore.getState().setSnapshot(sampleQueue, 0);
    setOptimisticTrack(sampleQueue[0], 'loading');
  } else {
    const activeIndex = await TrackPlayer.getActiveTrackIndex();
    playbackTarget = dspTargetFromTrack(queue[activeIndex ?? 0], 'immediate');
    await prepareAudioProcessingForPlayback(playbackTarget, 'sample-resume');
    useQueueStore.getState().setSnapshot(queue, activeIndex);
    setOptimisticTrack(queue[activeIndex ?? 0], 'loading');
  }
  try {
    await primePreparedTrackForPlayback(playbackTarget, 'sample-play');
    await TrackPlayer.play();
    usePlayerStore.getState().setPlaybackState('playing');
  } catch (err) {
    await reconcilePlayerFromNative();
    throw err;
  }
}

export async function play(): Promise<void> {
  selectPhonePlaybackTarget();
  try {
    const activeTrack = await TrackPlayer.getActiveTrack();
    await prepareAudioProcessingForPlayback(
      dspTargetFromTrack(activeTrack, 'immediate'),
      'controller-play',
    );
    await TrackPlayer.play();
    usePlayerStore.getState().setPlaybackState('playing');
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
  await ensurePlayerReady();
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
  await ensurePlayerReady();
  const [nativeQueue, nativeIndex] = await Promise.all([
    TrackPlayer.getQueue(),
    TrackPlayer.getActiveTrackIndex(),
  ]);
  await prepareAudioProcessingForPlayback(
    dspTargetFromTrack(
      nativeIndex == null ? undefined : nativeQueue[nativeIndex + 1],
      'none',
    ),
    'skip-next',
  );
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
  await ensurePlayerReady();

  // Use RNTP's position so headless Bluetooth/Auto commands do not depend on
  // the UI-mounted progress mirror. A failed read preserves the old skip path.
  let nativePosition: number | null = null;
  try {
    nativePosition = (await TrackPlayer.getProgress()).position;
  } catch {
    // Fall through to the existing previous-track behavior.
  }
  if (nativePosition != null && shouldRestartOnPrevious(nativePosition)) {
    await seekTo(0);
    return;
  }

  const [nativeQueue, nativeIndex] = await Promise.all([
    TrackPlayer.getQueue(),
    TrackPlayer.getActiveTrackIndex(),
  ]);
  await prepareAudioProcessingForPlayback(
    dspTargetFromTrack(
      nativeIndex == null ? undefined : nativeQueue[nativeIndex - 1],
      'none',
    ),
    'skip-previous',
  );
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

interface QueueRemoveOptions {
  updateMirror?: boolean;
}

/** Replace everything after the current track with `upcoming` (in order). */
export async function setUpcoming(upcoming: RntpTrack[]): Promise<void> {
  await ensurePlayerReady();
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
  await ensurePlayerReady();
  await queueLoadSettled();
  await TrackPlayer.move(fromAbsoluteIndex, toAbsoluteIndex);
  useQueueStore.getState().moveItem(fromAbsoluteIndex, toAbsoluteIndex);
  moveOriginalOrderIfUnshuffled(fromAbsoluteIndex, toAbsoluteIndex);
}

/** Jump to (and play) an absolute queue index. */
export async function jumpToQueueIndex(index: number): Promise<void> {
  selectPhonePlaybackTarget();
  await ensurePlayerReady();
  // Mid-fill, the tapped row may not be in the native queue yet (or may sit at
  // a shifted native index while the head is still prepending) — translate,
  // waiting out the fill only when the target isn't loaded.
  const queuedTrack = useQueueStore.getState().tracks[index];
  const playbackTarget = dspTargetFromTrack(queuedTrack, 'none');
  useQueueStore.getState().setActiveIndex(index);
  setOptimisticTrack(queuedTrack, 'playing');
  let nativeIndex = absoluteIndexToNative(index);
  while (nativeIndex == null) {
    await queueLoadSettled();
    nativeIndex = absoluteIndexToNative(index);
  }
  try {
    await prepareAudioProcessingForPlayback(playbackTarget, 'queue-jump');
    await TrackPlayer.skip(nativeIndex);
    useQueueStore.getState().setActiveIndex(index);
    await primePreparedTrackForPlayback(playbackTarget, 'queue-jump');
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
export async function removeFromQueue(
  absoluteIndex: number,
  options: QueueRemoveOptions = {}
): Promise<void> {
  await ensurePlayerReady();
  await queueLoadSettled();
  await TrackPlayer.remove(absoluteIndex);
  if (options.updateMirror !== false) {
    useQueueStore.getState().removeIndices([absoluteIndex]);
  }
  pruneOriginalOrderToMirror();
}

/** Remove a group of tracks at absolute queue indices. */
export async function removeManyFromQueue(
  absoluteIndices: number[],
  options: QueueRemoveOptions = {}
): Promise<void> {
  if (absoluteIndices.length === 0) return;
  await ensurePlayerReady();
  await queueLoadSettled();
  await TrackPlayer.remove(absoluteIndices);
  if (options.updateMirror !== false) {
    useQueueStore.getState().removeIndices(absoluteIndices);
  }
  pruneOriginalOrderToMirror();
}

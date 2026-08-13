import TrackPlayer, {
  RepeatMode,
  State,
  type Track as RntpTrack,
} from 'react-native-track-player';
import type { PlaybackSource, PlaybackState, Track } from '@/types/audio';
import type { DbTrack } from '@/types/library';
import { usePlayerStore, type RepeatMode as RepeatModeStr } from '@/stores/playerStore';
import { useQueueStore } from '@/stores/queueStore';
import { usePlaybackTargetStore } from '@/stores/playbackTargetStore';
import { markNowPlayingTrackTransitionDirection } from '@/stores/nowPlayingTrackTransitionStore';
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
import {
  shouldRestartOnPrevious,
  shouldResumeAfterExplicitNext,
} from './playbackNavigation';
import {
  cancelManualRecentPlayTransition,
  markManualRecentPlayTransition,
} from './recentPlayTracking';
import {
  AstraLibraryData,
  type LibraryQuery,
  type NativePlaybackWindow,
} from '../../modules/astra-library-scanner';
import { dbTrackToTrack } from '@/library/trackAdapter';
import {
  VIRTUAL_PLAYBACK_APPEND_BATCH as TRANSPORT_APPEND_BATCH,
  VIRTUAL_PLAYBACK_HISTORY as TRANSPORT_HISTORY,
  VIRTUAL_PLAYBACK_REFILL_THRESHOLD as TRANSPORT_REFILL_THRESHOLD,
  VIRTUAL_PLAYBACK_UPCOMING as TRANSPORT_UPCOMING,
  VIRTUAL_PLAYBACK_WINDOW_SIZE as TRANSPORT_WINDOW_SIZE,
  shouldRefillVirtualPlayback,
  virtualPlaybackRefillLimit,
  virtualPlaybackTrimCount,
  virtualPlaybackWindowStart,
} from './virtualPlaybackWindow';

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
let virtualContext: {
  sessionId: string;
  queueRevision: number;
  windowStart: number;
  loadedEnd: number;
  totalCount: number;
} | null = null;
let virtualRefillPromise: Promise<void> | null = null;
let requestedQueueRevision = 0;
let requestedActivePosition: number | null = null;
let virtualRevisionSyncPromise: Promise<void> | null = null;

export {
  TRANSPORT_HISTORY,
  TRANSPORT_REFILL_THRESHOLD,
  TRANSPORT_UPCOMING,
};

export interface VirtualQueuePageItem {
  track: RntpTrack;
  queuePosition: number;
}

export interface VirtualQueuePage {
  items: VirtualQueuePageItem[];
  activePosition: number;
  totalCount: number;
}

export interface PlaybackStartOptions {
  startIndex?: number;
  source: PlaybackSource;
}

function toVirtualRntpTrack(
  item: DbTrack & { queuePosition: number; queueEntryId: number },
): RntpTrack {
  return {
    ...toRntpTrack(dbTrackToTrack(item)),
    astraQueuePosition: item.queuePosition,
    astraQueueEntryId: item.queueEntryId,
  };
}

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

function toEffectiveRntpRepeat(mode: RepeatModeStr): RepeatMode {
  if (virtualContext && mode === 'all') return RepeatMode.Off;
  return toRntpRepeat(mode);
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

function setVirtualQueueSnapshot(
  tracks: RntpTrack[],
  activeLocalIndex: number,
  source?: PlaybackSource | null,
): void {
  const context = virtualContext;
  useQueueStore.getState().setSnapshot(tracks, activeLocalIndex, {
    ...(source !== undefined ? { source } : {}),
    transport: context
      ? {
          sessionId: context.sessionId,
          queueRevision: context.queueRevision,
          windowStart: context.windowStart,
        }
      : null,
  });
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
    if (virtualContext) {
      setVirtualQueueSnapshot(materializedTracks, queue.activeIndex);
    } else {
      useQueueStore.getState().setSnapshot(materializedTracks, queue.activeIndex, {
        transport: null,
      });
    }
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
          await TrackPlayer.setRepeatMode(toEffectiveRntpRepeat(repeat));
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
  await TrackPlayer.setRepeatMode(toEffectiveRntpRepeat(usePlayerStore.getState().repeat));
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
    source: queue.source,
  };
}

export function restorePlaybackSession(
  session: ResolvedPlaybackSession<Track> | null
): void {
  const player = usePlayerStore.getState();
  if (!session || session.tracks.length === 0) {
    originalOrder = null;
    useQueueStore.getState().setSnapshot([], -1, { source: null, transport: null });
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
  useQueueStore.getState().setSnapshot(queueTracks, session.activeIndex, {
    source: session.source,
    transport: null,
  });
  player.setCurrentTrack(activeTrack);
  player.setProgress(session.position, activeTrack.duration);
  player.clearPendingSeek();
  player.setShuffle(session.shuffle);
  player.setRepeat(session.repeat);
  player.setPlaybackState('paused');
  player.setRestoredSessionPending(true);
}

/**
 * Hydrates a persisted native virtual context without starting playback. The
 * rolling window is materialized only when the user presses Play.
 */
export function restoreVirtualPlaybackContext(
  window: NativePlaybackWindow<DbTrack>,
  session: PlaybackSessionSnapshotV1,
): void {
  const tracks = window.items.map(dbTrackToTrack);
  if (tracks.length === 0) {
    restorePlaybackSession(null);
    return;
  }
  const queueTracks = window.items.map(toVirtualRntpTrack);
  const activeIndex = Math.max(
    0,
    Math.min(queueTracks.length - 1, window.activePosition - window.windowStart),
  );
  virtualContext = {
    sessionId: window.sessionId,
    queueRevision: window.queueRevision,
    windowStart: window.windowStart,
    loadedEnd: window.items[window.items.length - 1].queuePosition + 1,
    totalCount: window.totalCount,
  };
  requestedQueueRevision = window.queueRevision;
  originalOrder = session.shuffle ? null : tracks.map((track) => track.id);
  setVirtualQueueSnapshot(queueTracks, activeIndex, session.source);
  const activeTrack = tracks[activeIndex];
  const player = usePlayerStore.getState();
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
export async function playTracks(
  tracks: Track[],
  options: PlaybackStartOptions
): Promise<void> {
  virtualContext = null;
  return playTracksInternal(tracks, options, { allowBackgroundSetup: false });
}

/** Android Auto can request playback while the React UI is not foregrounded. */
export async function playTracksForCar(
  tracks: Track[],
  options: PlaybackStartOptions
): Promise<void> {
  virtualContext = null;
  return playTracksInternal(tracks, options, { allowBackgroundSetup: true });
}

export interface LibraryPlaybackStartOptions extends PlaybackStartOptions {
  anchorPath?: string | null;
  shuffle?: boolean;
  allowBackgroundSetup?: boolean;
}

/**
 * Starts a native virtual library context. Only eight historical, the current,
 * and 32 upcoming tracks cross into JavaScript; complete order remains in Room.
 */
export async function playLibraryQuery(
  query: LibraryQuery,
  options: LibraryPlaybackStartOptions,
): Promise<void> {
  selectPhonePlaybackTarget();
  discardPendingRestoredSession();
  await ensurePlayerReady({
    allowBackgroundSetup: options.allowBackgroundSetup ?? false,
    materializeRestored: false,
  });
  const window = await AstraLibraryData.createPlaybackContext<DbTrack>(
    query,
    options.anchorPath ?? null,
    options.shuffle ?? false,
    null,
  );
  if (window.items.length === 0) return;
  await startVirtualWindow(window, options.source, options.shuffle ?? false);
}

async function startVirtualWindow(
  window: NativePlaybackWindow<DbTrack>,
  source: PlaybackSource,
  shuffle: boolean,
): Promise<void> {
  const tracks = window.items.map(dbTrackToTrack);
  const queueTracks = window.items.map(toVirtualRntpTrack);
  const startIndex = Math.max(
    0,
    Math.min(queueTracks.length - 1, window.activePosition - window.windowStart),
  );
  virtualContext = {
    sessionId: window.sessionId,
    queueRevision: window.queueRevision,
    windowStart: window.windowStart,
    loadedEnd: window.items.length === 0
      ? window.windowStart
      : window.items[window.items.length - 1].queuePosition + 1,
    totalCount: window.totalCount,
  };
  requestedQueueRevision = window.queueRevision;
  await TrackPlayer.setRepeatMode(toEffectiveRntpRepeat(usePlayerStore.getState().repeat));
  originalOrder = shuffle ? null : tracks.map((track) => track.id);
  usePlayerStore.getState().setShuffle(shuffle);
  const playbackTarget = dspTargetFromTrack(queueTracks[startIndex], 'none');
  const manualTransitionFromPath = usePlayerStore.getState().currentTrack?.path ?? null;
  setVirtualQueueSnapshot(queueTracks, startIndex, source);
  setOptimisticTrack(queueTracks[startIndex], 'loading');
  try {
    await prepareAudioProcessingForPlayback(playbackTarget, 'virtual-queue-play');
    await loadQueueChunked(queueTracks, startIndex, { manualTransitionFromPath });
    await primePreparedTrackForPlayback(playbackTarget, 'virtual-queue-play');
    await TrackPlayer.play();
    usePlayerStore.getState().setPlaybackState('playing');
  } catch (error) {
    virtualContext = null;
    await reconcilePlayerFromNative();
    throw error;
  }
}

/** Keeps the rolling native queue bounded while natural playback advances. */
export function handleVirtualPlaybackAdvance(_nativeEventIndex?: number): Promise<void> {
  if (!virtualContext) return Promise.resolve();
  if (virtualRefillPromise) return virtualRefillPromise;
  virtualRefillPromise = replenishVirtualContext().finally(() => {
    virtualRefillPromise = null;
  });
  return virtualRefillPromise;
}

/** Continues a starved bounded window, or implements repeat-all over Room. */
export async function handleVirtualQueueEnded(): Promise<boolean> {
  const context = virtualContext;
  if (!context || context.totalCount <= 0) return false;
  await queueLoadSettled();
  if (virtualContext !== context) return false;
  const currentPosition =
    context.windowStart + Math.max(0, useQueueStore.getState().activeIndex);
  const target = context.loadedEnd < context.totalCount
    ? Math.min(context.totalCount - 1, currentPosition + 1)
    : usePlayerStore.getState().repeat === 'all'
      ? 0
      : null;
  if (target == null) return false;
  await AstraLibraryData.updatePlaybackPosition(context.sessionId, target);
  const window = await AstraLibraryData.getPlaybackWindow<DbTrack>(
    context.sessionId,
    virtualPlaybackWindowStart(target),
    TRANSPORT_WINDOW_SIZE,
  );
  if (virtualContext !== context || window.items.length === 0) return false;
  await startVirtualWindow(
    window,
    useQueueStore.getState().source ?? { kind: 'library', label: 'Library' },
    usePlayerStore.getState().shuffle,
  );
  return true;
}

async function appendTransportTracks(
  tracks: RntpTrack[],
  baseCount: number,
): Promise<void> {
  for (let index = 0; index < tracks.length; index += TRANSPORT_APPEND_BATCH) {
    await appendUpcomingChunked(
      tracks.slice(index, index + TRANSPORT_APPEND_BATCH),
      baseCount + index,
    );
  }
}

async function replenishVirtualContext(): Promise<void> {
  const context = virtualContext;
  if (!context) return;
  await queueLoadSettled();
  if (virtualContext !== context) return;
  const nativeIndex = await TrackPlayer.getActiveTrackIndex() ?? -1;
  if (nativeIndex < 0) return;
  const activePosition = context.windowStart + nativeIndex;
  void AstraLibraryData.updatePlaybackPosition(context.sessionId, activePosition).catch(() => {});

  let localIndex = nativeIndex;
  const removeCount = virtualPlaybackTrimCount(localIndex);
  if (removeCount > 0) {
    const indices = Array.from({ length: removeCount }, (_, index) => index);
    await TrackPlayer.remove(indices);
    useQueueStore.getState().removeIndices(indices);
    context.windowStart += removeCount;
    localIndex -= removeCount;
  }

  const currentLength = useQueueStore.getState().tracks.length;
  const upcoming = currentLength - localIndex - 1;
  if (!shouldRefillVirtualPlayback(
    upcoming,
    context.loadedEnd,
    context.totalCount,
  )) return;
  const requested = virtualPlaybackRefillLimit(
    upcoming,
    context.loadedEnd,
    context.totalCount,
  );
  if (requested <= 0) return;
  const next = await AstraLibraryData.getPlaybackWindow<DbTrack>(
    context.sessionId,
    context.loadedEnd,
    requested,
  );
  if (virtualContext !== context || next.items.length === 0) return;
  const additions = next.items
    .filter((item) => (
      item.queuePosition >= context.loadedEnd &&
      item.queuePosition < context.totalCount
    ))
    .map(toVirtualRntpTrack);
  if (additions.length === 0) return;
  const nextLoadedEnd = Number(additions[additions.length - 1].astraQueuePosition) + 1;
  if (!Number.isFinite(nextLoadedEnd) || nextLoadedEnd <= context.loadedEnd) return;
  const before = useQueueStore.getState();
  await appendTransportTracks(additions, before.tracks.length);
  context.loadedEnd = Math.min(context.totalCount, nextLoadedEnd);
  context.queueRevision = Math.max(context.queueRevision, next.queueRevision);
  setVirtualQueueSnapshot([...before.tracks, ...additions], localIndex);
}

/** Returns a bounded page from the native virtual queue, or null for ordinary queues. */
export async function getVirtualQueuePage(
  start: number,
  limit = 100,
): Promise<VirtualQueuePage | null> {
  const context = virtualContext;
  if (!context) return null;
  const window = await AstraLibraryData.getPlaybackWindow<DbTrack>(
    context.sessionId,
    Math.max(0, start),
    Math.max(1, Math.min(250, limit)),
  );
  if (virtualContext !== context) return null;
  const boundedStart = Math.max(0, start);
  return {
    items: window.items
      .filter((item) => (
        item.queuePosition >= boundedStart &&
        item.queuePosition < window.totalCount
      ))
      .map((item) => ({
        track: toVirtualRntpTrack(item),
        queuePosition: item.queuePosition,
      })),
    activePosition: window.activePosition,
    totalCount: window.totalCount,
  };
}

export function getVirtualQueueState(): {
  sessionId: string;
  queueRevision: number;
  activePosition: number;
  totalCount: number;
} | null {
  const context = virtualContext;
  if (!context) return null;
  const localActive = useQueueStore.getState().activeIndex;
  return {
    sessionId: context.sessionId,
    queueRevision: context.queueRevision,
    activePosition: context.windowStart + Math.max(0, localActive),
    totalCount: context.totalCount,
  };
}

/**
 * Coalesces Room revisions emitted by the Kotlin queue and rebuilds only RNTP's
 * bounded upcoming tail. The currently playing MediaSource is never replaced.
 */
export function synchronizeVirtualQueueRevision(
  queueRevision: number,
  activePosition?: number,
): Promise<void> {
  const context = virtualContext;
  if (!context || queueRevision <= context.queueRevision) return Promise.resolve();
  requestedQueueRevision = Math.max(requestedQueueRevision, queueRevision);
  if (activePosition != null) requestedActivePosition = activePosition;
  if (virtualRevisionSyncPromise) return virtualRevisionSyncPromise;

  virtualRevisionSyncPromise = (async () => {
    while (virtualContext && requestedQueueRevision > virtualContext.queueRevision) {
      const targetRevision = requestedQueueRevision;
      const targetActive = requestedActivePosition;
      requestedActivePosition = null;
      await synchronizeVirtualTransportOnce(targetRevision, targetActive);
    }
  })().finally(() => {
    virtualRevisionSyncPromise = null;
  });
  return virtualRevisionSyncPromise;
}

async function synchronizeVirtualTransportOnce(
  targetRevision: number,
  emittedActivePosition: number | null,
): Promise<void> {
  const context = virtualContext;
  if (!context || targetRevision <= context.queueRevision) return;
  await queueLoadSettled();
  if (virtualContext !== context) return;
  const nativeIndex = await TrackPlayer.getActiveTrackIndex();
  if (nativeIndex == null || nativeIndex < 0) return;
  const activePosition = emittedActivePosition ??
    context.windowStart + nativeIndex;
  const window = await AstraLibraryData.getPlaybackWindow<DbTrack>(
    context.sessionId,
    virtualPlaybackWindowStart(activePosition),
    TRANSPORT_WINDOW_SIZE,
  );
  if (virtualContext !== context || window.queueRevision < targetRevision) return;

  const upcoming = window.items
    .filter((item) => item.queuePosition > window.activePosition)
    .slice(0, TRANSPORT_UPCOMING)
    .map(toVirtualRntpTrack);
  const before = useQueueStore.getState();
  const prefix = before.tracks.slice(0, nativeIndex + 1);
  await TrackPlayer.removeUpcomingTracks();
  await appendTransportTracks(upcoming, prefix.length);
  context.windowStart = window.activePosition - nativeIndex;
  context.loadedEnd = window.activePosition + upcoming.length + 1;
  context.totalCount = window.totalCount;
  context.queueRevision = window.queueRevision;
  setVirtualQueueSnapshot([...prefix, ...upcoming], nativeIndex);
}

async function adoptCurrentQueueAsVirtualContext(): Promise<boolean> {
  if (virtualContext) return true;
  const snapshot = await getQueueSnapshot();
  if (snapshot.queue.length === 0) return false;
  const activeIndex = Math.max(0, snapshot.activeIndex);
  const paths = snapshot.queue.map(rntpTrackPath);
  const window = await AstraLibraryData.createPlaybackContext<DbTrack>(
    { kind: 'manual', paths },
    paths[activeIndex] ?? null,
    false,
    null,
  );
  virtualContext = {
    sessionId: window.sessionId,
    queueRevision: window.queueRevision,
    windowStart: window.activePosition - activeIndex,
    loadedEnd: Math.min(window.totalCount, snapshot.queue.length),
    totalCount: window.totalCount,
  };
  requestedQueueRevision = window.queueRevision;
  originalOrder = null;
  return true;
}

/**
 * Applies a native virtual-queue edit without replacing the playing row. Only
 * RNTP's bounded upcoming tail is rebuilt; the current audio item keeps playing.
 */
async function mutateVirtualQueue(
  operation:
    | 'insertAfterActive'
    | 'append'
    | 'insertQueryAfterActive'
    | 'appendQuery'
    | 'remove'
    | 'move'
    | 'moveManyAfterActive'
    | 'shuffle',
  values: Record<string, unknown>,
): Promise<NativePlaybackWindow<DbTrack> | null> {
  const context = virtualContext;
  if (!context) return null;
  await queueLoadSettled();
  if (virtualContext !== context) return null;
  const [window, nativeIndex] = await Promise.all([
    AstraLibraryData.mutatePlaybackContext<DbTrack>(operation, values),
    TrackPlayer.getActiveTrackIndex(),
  ]);
  if (!window || virtualContext !== context) return window;

  const activeLocal = nativeIndex ?? useQueueStore.getState().activeIndex;
  const boundedActive = Math.max(0, activeLocal);
  const upcoming = window.items
    .filter((item) => item.queuePosition > window.activePosition)
    .map(toVirtualRntpTrack);
  const before = useQueueStore.getState();
  const prefix = before.tracks.slice(0, boundedActive + 1);

  context.queueRevision = window.queueRevision;
  await TrackPlayer.removeUpcomingTracks();
  await appendTransportTracks(upcoming.slice(0, TRANSPORT_UPCOMING), prefix.length);
  context.windowStart = window.activePosition - boundedActive;
  context.loadedEnd = upcoming.length > 0
    ? window.activePosition + Math.min(upcoming.length, TRANSPORT_UPCOMING) + 1
    : window.activePosition + 1;
  context.totalCount = window.totalCount;
  setVirtualQueueSnapshot(
    [...prefix, ...upcoming.slice(0, TRANSPORT_UPCOMING)],
    boundedActive,
  );
  return window;
}

/** Adds an entire native query context without materializing it in JavaScript. */
export async function enqueueLibraryQuery(
  query: LibraryQuery,
  placement: 'next' | 'end',
): Promise<void> {
  await ensurePlayerReady();
  await queueLoadSettled();
  if (!await adoptCurrentQueueAsVirtualContext()) return;
  await mutateVirtualQueue(
    placement === 'next' ? 'insertQueryAfterActive' : 'appendQuery',
    { context: query },
  );
}

async function playTracksInternal(
  tracks: Track[],
  startOptions: PlaybackStartOptions,
  options: { allowBackgroundSetup: boolean },
): Promise<void> {
  if (tracks.length === 0) return;
  const startIndex = startOptions.startIndex ?? 0;
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
  const manualTransitionFromPath = usePlayerStore.getState().currentTrack?.path ?? null;
  useQueueStore.getState().setSnapshot(queueTracks, startIndex, {
    source: startOptions.source,
    transport: null,
  });
  setOptimisticTrack(queueTracks[startIndex], 'loading');
  try {
    await prepareAudioProcessingForPlayback(playbackTarget, 'queue-play');
    await loadQueueChunked(queueTracks, startIndex, { manualTransitionFromPath });
    await primePreparedTrackForPlayback(playbackTarget, 'queue-play');
    await TrackPlayer.play();
    usePlayerStore.getState().setPlaybackState('playing');
  } catch (err) {
    await reconcilePlayerFromNative();
    throw err;
  }
}

/** Shuffle a context and play from the top (the library/album "Shuffle" buttons). */
export async function shuffleTracks(
  tracks: Track[],
  source: PlaybackSource
): Promise<void> {
  if (tracks.length === 0) return;
  virtualContext = null;
  selectPhonePlaybackTarget();
  discardPendingRestoredSession();
  await ensurePlayerReady({ materializeRestored: false });
  originalOrder = tracks.map((t) => t.id);
  usePlayerStore.getState().setShuffle(true);
  const queueTracks = shuffleArray(tracks).map(toRntpTrack);
  const playbackTarget = dspTargetFromTrack(queueTracks[0], 'none');
  const manualTransitionFromPath = usePlayerStore.getState().currentTrack?.path ?? null;
  useQueueStore.getState().setSnapshot(queueTracks, 0, { source, transport: null });
  setOptimisticTrack(queueTracks[0], 'loading');
  try {
    await prepareAudioProcessingForPlayback(playbackTarget, 'shuffle-play');
    await loadQueueChunked(queueTracks, 0, { manualTransitionFromPath });
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
    useQueueStore.getState().setSnapshot(sampleQueue, 0, {
      source: { kind: 'sample', label: 'Astra Sample' },
      transport: null,
    });
    setOptimisticTrack(sampleQueue[0], 'loading');
  } else {
    const activeIndex = await TrackPlayer.getActiveTrackIndex();
    playbackTarget = dspTargetFromTrack(queue[activeIndex ?? 0], 'immediate');
    await prepareAudioProcessingForPlayback(playbackTarget, 'sample-resume');
    useQueueStore.getState().setSnapshot(queue, activeIndex, { transport: null });
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
  markNowPlayingTrackTransitionDirection('next', 'phone');
  await ensurePlayerReady();
  const [nativeQueue, nativeIndex, nativePlaybackState] = await Promise.all([
    TrackPlayer.getQueue(),
    TrackPlayer.getActiveTrackIndex(),
    TrackPlayer.getPlaybackState(),
  ]);
  const playbackStateAtIntent = mapRntpState(nativePlaybackState.state);
  const resumeAfterSkip = shouldResumeAfterExplicitNext(playbackStateAtIntent);
  const virtualState = getVirtualQueueState();
  if (
    virtualState &&
    nativeIndex != null &&
    nativeIndex >= nativeQueue.length - 1 &&
    virtualState.activePosition + 1 < virtualState.totalCount
  ) {
    await jumpToQueueIndex(virtualState.activePosition + 1, { virtualPosition: true });
    return;
  }
  const playbackTarget = dspTargetFromTrack(
    nativeIndex == null ? undefined : nativeQueue[nativeIndex + 1],
    'none',
  );
  await prepareAudioProcessingForPlayback(
    playbackTarget,
    'skip-next',
  );
  const { tracks, activeIndex } = useQueueStore.getState();
  const nextIndex = activeIndex >= 0 ? activeIndex + 1 : -1;
  const manualTransitionFromPath = usePlayerStore.getState().currentTrack?.path ?? null;
  if (nextIndex >= 0 && nextIndex < tracks.length) {
    useQueueStore.getState().setActiveIndex(nextIndex);
    setOptimisticTrack(
      tracks[nextIndex],
      resumeAfterSkip ? 'loading' : playbackStateAtIntent,
    );
  }
  const manualTransition = markManualRecentPlayTransition(manualTransitionFromPath);
  let nativeTransitionSucceeded = false;
  try {
    await TrackPlayer.skipToNext();
    nativeTransitionSucceeded = true;
    await refreshActiveIndexFromNative();
    if (resumeAfterSkip) {
      await primePreparedTrackForPlayback(playbackTarget, 'skip-next-resume');
      await TrackPlayer.play();
      usePlayerStore.getState().setPlaybackState('playing');
    }
  } catch {
    if (!nativeTransitionSucceeded) cancelManualRecentPlayTransition(manualTransition);
    await reconcilePlayerFromNative();
    // No next track or resume failed — keep the reconciled native state.
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

  markNowPlayingTrackTransitionDirection('previous', 'phone');
  const [nativeQueue, nativeIndex] = await Promise.all([
    TrackPlayer.getQueue(),
    TrackPlayer.getActiveTrackIndex(),
  ]);
  const virtualState = getVirtualQueueState();
  if (virtualState && nativeIndex === 0 && virtualState.activePosition > 0) {
    await jumpToQueueIndex(virtualState.activePosition - 1, { virtualPosition: true });
    return;
  }
  await prepareAudioProcessingForPlayback(
    dspTargetFromTrack(
      nativeIndex == null ? undefined : nativeQueue[nativeIndex - 1],
      'none',
    ),
    'skip-previous',
  );
  const { tracks, activeIndex } = useQueueStore.getState();
  const previousIndex = activeIndex > 0 ? activeIndex - 1 : -1;
  const manualTransitionFromPath = usePlayerStore.getState().currentTrack?.path ?? null;
  if (previousIndex >= 0 && previousIndex < tracks.length) {
    useQueueStore.getState().setActiveIndex(previousIndex);
    setOptimisticTrack(tracks[previousIndex], usePlayerStore.getState().playbackState);
  }
  const manualTransition = markManualRecentPlayTransition(manualTransitionFromPath);
  let nativeTransitionSucceeded = false;
  try {
    await TrackPlayer.skipToPrevious();
    nativeTransitionSucceeded = true;
    await refreshActiveIndexFromNative();
  } catch {
    if (!nativeTransitionSucceeded) cancelManualRecentPlayTransition(manualTransition);
    await reconcilePlayerFromNative();
    // no previous track — ignore
  }
}

/** Cycle repeat none → all → one (desktop order) and push it to RNTP. */
export async function cycleRepeat(): Promise<void> {
  const next = NEXT_REPEAT[usePlayerStore.getState().repeat];
  usePlayerStore.getState().setRepeat(next);
  await ensurePlayerReady();
  await TrackPlayer.setRepeatMode(toEffectiveRntpRepeat(next));
}

/**
 * Toggle shuffle. The current track keeps playing untouched (no audio gap); only
 * the upcoming tail is re-ordered: scrambled when turning on, restored to
 * `originalOrder` when turning off.
 */
export async function toggleShuffle(): Promise<void> {
  const store = usePlayerStore.getState();
  const next = !store.shuffle;
  // The control is a direct-manipulation toggle: reflect it immediately while
  // Room reorders the authoritative queue and the bounded RNTP tail catches up.
  // A failed native mutation rolls the visual state back.
  store.setShuffle(next);
  await ensurePlayerReady();
  await queueLoadSettled();

  if (virtualContext) {
    try {
      await mutateVirtualQueue('shuffle', {
        enabled: next,
        seed: next ? Date.now() : null,
      });
    } catch (error) {
      store.setShuffle(!next);
      throw error;
    }
    return;
  }

  try {
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

    useQueueStore.getState().setSnapshot(mirroredQueue, activeIndex, { transport: null });
  } catch (error) {
    store.setShuffle(!next);
    throw error;
  }
}

/** Insert a track right after the current one ("Play next"). */
export async function enqueueTop(track: Track): Promise<void> {
  await ensurePlayerReady();
  await queueLoadSettled();
  if (virtualContext) {
    await mutateVirtualQueue('insertAfterActive', { paths: [track.path] });
    return;
  }
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
  if (virtualContext) {
    await mutateVirtualQueue('append', { paths: [track.path] });
    return;
  }
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
  if (virtualContext) {
    await mutateVirtualQueue('insertAfterActive', {
      paths: tracks.map((track) => track.path),
    });
    return;
  }
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
  if (virtualContext) {
    await mutateVirtualQueue('append', {
      paths: tracks.map((track) => track.path),
    });
    return;
  }
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
  virtualPosition?: boolean;
}

interface QueuePositionOptions {
  virtualPosition?: boolean;
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
export async function moveQueueItem(
  fromAbsoluteIndex: number,
  toAbsoluteIndex: number,
  options: QueuePositionOptions = {},
): Promise<void> {
  if (fromAbsoluteIndex === toAbsoluteIndex) return;
  await ensurePlayerReady();
  await queueLoadSettled();
  if (virtualContext) {
    const from = options.virtualPosition
      ? fromAbsoluteIndex
      : virtualContext.windowStart + fromAbsoluteIndex;
    const to = options.virtualPosition
      ? toAbsoluteIndex
      : virtualContext.windowStart + toAbsoluteIndex;
    await mutateVirtualQueue('move', { from, to });
    return;
  }
  await TrackPlayer.move(fromAbsoluteIndex, toAbsoluteIndex);
  useQueueStore.getState().moveItem(fromAbsoluteIndex, toAbsoluteIndex);
  moveOriginalOrderIfUnshuffled(fromAbsoluteIndex, toAbsoluteIndex);
}

/** Jump to (and play) an absolute queue index. */
export async function jumpToQueueIndex(
  index: number,
  options: QueuePositionOptions = {},
): Promise<void> {
  selectPhonePlaybackTarget();
  await ensurePlayerReady();
  if (virtualContext) {
    const context = virtualContext;
    const position = options.virtualPosition ? index : context.windowStart + index;
    const bounded = Math.max(0, Math.min(context.totalCount - 1, position));
    await AstraLibraryData.updatePlaybackPosition(context.sessionId, bounded);
    const window = await AstraLibraryData.getPlaybackWindow<DbTrack>(
      context.sessionId,
      virtualPlaybackWindowStart(bounded),
      TRANSPORT_WINDOW_SIZE,
    );
    await startVirtualWindow(
      window,
      useQueueStore.getState().source ?? { kind: 'library', label: 'Library' },
      usePlayerStore.getState().shuffle,
    );
    return;
  }
  // Mid-fill, the tapped row may not be in the native queue yet (or may sit at
  // a shifted native index while the head is still prepending) — translate,
  // waiting out the fill only when the target isn't loaded.
  const queuedTrack = useQueueStore.getState().tracks[index];
  const playbackTarget = dspTargetFromTrack(queuedTrack, 'none');
  const manualTransitionFromPath = usePlayerStore.getState().currentTrack?.path ?? null;
  useQueueStore.getState().setActiveIndex(index);
  setOptimisticTrack(queuedTrack, 'playing');
  let nativeIndex = absoluteIndexToNative(index);
  while (nativeIndex == null) {
    await queueLoadSettled();
    nativeIndex = absoluteIndexToNative(index);
  }
  let manualTransition: ReturnType<typeof markManualRecentPlayTransition> = null;
  let nativeTransitionSucceeded = false;
  try {
    await prepareAudioProcessingForPlayback(playbackTarget, 'queue-jump');
    manualTransition = markManualRecentPlayTransition(manualTransitionFromPath);
    await TrackPlayer.skip(nativeIndex);
    nativeTransitionSucceeded = true;
    useQueueStore.getState().setActiveIndex(index);
    await primePreparedTrackForPlayback(playbackTarget, 'queue-jump');
    await TrackPlayer.play();
    usePlayerStore.getState().setPlaybackState('playing');
  } catch (err) {
    if (!nativeTransitionSucceeded) cancelManualRecentPlayTransition(manualTransition);
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
export async function requeueToTop(
  absoluteIndex: number,
  options: QueuePositionOptions = {},
): Promise<void> {
  if (virtualContext) {
    const position = options.virtualPosition
      ? absoluteIndex
      : virtualContext.windowStart + absoluteIndex;
    await mutateVirtualQueue('move', {
      from: position,
      to: (getVirtualQueueState()?.activePosition ?? 0) + 1,
    });
    return;
  }
  const { activeIndex, upcoming } = await getUpcoming();
  const local = absoluteIndex - (activeIndex + 1);
  if (local < 0 || local >= upcoming.length) return;
  const [moved] = upcoming.splice(local, 1);
  upcoming.unshift(moved);
  await setUpcoming(upcoming);
}

/** Move a group of upcoming tracks (absolute indices) to the front, order kept. */
export async function requeueManyToTop(
  absoluteIndices: number[],
  options: QueuePositionOptions = {},
): Promise<void> {
  if (virtualContext) {
    await mutateVirtualQueue('moveManyAfterActive', {
      positions: options.virtualPosition
        ? absoluteIndices
        : absoluteIndices.map((index) => virtualContext!.windowStart + index),
    });
    return;
  }
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
  if (virtualContext) {
    const position = options.virtualPosition
      ? absoluteIndex
      : virtualContext.windowStart + absoluteIndex;
    await mutateVirtualQueue('remove', { positions: [position] });
    return;
  }
  const activeIndex = useQueueStore.getState().activeIndex;
  const manualTransition = absoluteIndex === activeIndex
    ? markManualRecentPlayTransition(usePlayerStore.getState().currentTrack?.path)
    : null;
  try {
    await TrackPlayer.remove(absoluteIndex);
  } catch (error) {
    cancelManualRecentPlayTransition(manualTransition);
    throw error;
  }
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
  if (virtualContext) {
    await mutateVirtualQueue('remove', {
      positions: options.virtualPosition
        ? absoluteIndices
        : absoluteIndices.map((index) => virtualContext!.windowStart + index),
    });
    return;
  }
  const activeIndex = useQueueStore.getState().activeIndex;
  const manualTransition = absoluteIndices.includes(activeIndex)
    ? markManualRecentPlayTransition(usePlayerStore.getState().currentTrack?.path)
    : null;
  try {
    await TrackPlayer.remove(absoluteIndices);
  } catch (error) {
    cancelManualRecentPlayTransition(manualTransition);
    throw error;
  }
  if (options.updateMirror !== false) {
    useQueueStore.getState().removeIndices(absoluteIndices);
  }
  pruneOriginalOrderToMirror();
}

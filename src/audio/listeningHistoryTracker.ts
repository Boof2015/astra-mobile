import TrackPlayer, {
  State,
  type PlaybackActiveTrackChangedEvent,
  type Track as RntpTrack,
} from 'react-native-track-player';
import { AstraLibraryData } from '../../modules/astra-library-scanner';
import type {
  ListeningCheckpointResult,
  ListeningHistoryStatus,
  ListeningSessionCheckpoint,
} from '@/types/listeningStats';
import { consumeManualRecentPlayTransition } from './recentPlayTracking';
import { rntpToTrack } from './sampleTracks';
import { notifyListeningHistoryChanged } from '@/listeningStats/events';
import {
  LISTENING_QUALIFICATION_SECONDS,
  listenedTickDeltaMs,
  listeningCheckpointDue,
  playbackAppearsNaturallyCompleted,
} from './listeningHistoryState';

interface ActiveListeningSession {
  generation: string;
  sessionKey: string;
  segmentKey: string | null;
  trackPath: string;
  durationSeconds: number;
  sessionStartedAt: number;
  segmentStartedAt: number | null;
  sessionListenedSeconds: number;
  segmentListenedSeconds: number;
  lastTickAt: number | null;
  lastCheckpointSeconds: number;
  qualifiedCheckpointSent: boolean;
}

let status: ListeningHistoryStatus | null = null;
let active: ActiveListeningSession | null = null;
let isPlaying = false;
let operation = Promise.resolve();

function key(prefix: string, now = Date.now()): string {
  return `${prefix}:${now.toString(36)}:${Math.random().toString(36).slice(2, 10)}`;
}

function enqueue(task: () => Promise<void>): void {
  operation = operation.then(task, task).catch((error) => {
    console.warn('[listening-history] tracker operation failed', error);
  });
}

function finiteDuration(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0;
}

function beginSession(track: RntpTrack | undefined, now = Date.now()): void {
  if (!track || !status?.enabled) {
    active = null;
    return;
  }
  const astraTrack = rntpToTrack(track);
  if (!astraTrack.path) {
    active = null;
    return;
  }
  active = {
    generation: status.generation,
    sessionKey: key('session', now),
    segmentKey: null,
    trackPath: astraTrack.path,
    durationSeconds: finiteDuration(astraTrack.duration),
    sessionStartedAt: now,
    segmentStartedAt: null,
    sessionListenedSeconds: 0,
    segmentListenedSeconds: 0,
    lastTickAt: null,
    lastCheckpointSeconds: 0,
    qualifiedCheckpointSent: false,
  };
  if (isPlaying) beginSegment(now);
}

function beginSegment(now: number): void {
  if (!active || active.segmentKey) return;
  active.segmentKey = key('segment', now);
  active.segmentStartedAt = now;
  active.segmentListenedSeconds = 0;
  active.lastTickAt = now;
}

function advance(now: number): void {
  if (!active || !isPlaying || !active.segmentKey || active.lastTickAt == null) return;
  const elapsedMs = listenedTickDeltaMs(active.lastTickAt, now, true);
  const elapsedSeconds = elapsedMs / 1_000;
  active.sessionListenedSeconds += elapsedSeconds;
  active.segmentListenedSeconds += elapsedSeconds;
  active.lastTickAt = now;
}

function shouldCheckpoint(session: ActiveListeningSession): boolean {
  return listeningCheckpointDue({
    listenedSeconds: session.sessionListenedSeconds,
    lastCheckpointSeconds: session.lastCheckpointSeconds,
    qualificationCheckpointSent: session.qualifiedCheckpointSent,
    durationSeconds: session.durationSeconds,
  });
}

async function persist(
  now: number,
  finalizeSegment: boolean,
  finalizeSession: boolean,
  completedNaturally: boolean,
): Promise<void> {
  const session = active;
  if (!session || (!session.segmentKey && !finalizeSession)) return;
  const payload: ListeningSessionCheckpoint = {
    generation: session.generation,
    sessionKey: session.sessionKey,
    segmentKey: session.segmentKey ?? '',
    trackPath: session.trackPath,
    sessionStartedAt: session.sessionStartedAt,
    segmentStartedAt: session.segmentStartedAt ?? now,
    observedAt: now,
    sessionListenedSeconds: session.sessionListenedSeconds,
    segmentListenedSeconds: session.segmentListenedSeconds,
    trackDurationSeconds: session.durationSeconds,
    finalizeSegment,
    finalizeSession,
    completedNaturally,
    qualificationEligible: true,
  };
  const result = await AstraLibraryData.checkpointListeningSession<ListeningCheckpointResult>(
    payload as unknown as Record<string, unknown>,
  );
  status = result.status;
  if (!result.accepted) {
    active = null;
    return;
  }
  notifyListeningHistoryChanged(result.qualifiedNow);
  session.lastCheckpointSeconds = session.sessionListenedSeconds;
  if (session.sessionListenedSeconds >= LISTENING_QUALIFICATION_SECONDS) {
    session.qualifiedCheckpointSent = true;
  }
}

async function closeSegment(now: number): Promise<void> {
  if (!active?.segmentKey) return;
  await persist(now, true, false, false);
  if (!active) return;
  active.segmentKey = null;
  active.segmentStartedAt = null;
  active.segmentListenedSeconds = 0;
  active.lastTickAt = null;
}

async function closeSession(now: number, completedNaturally: boolean): Promise<void> {
  if (!active) return;
  await persist(now, Boolean(active.segmentKey), true, completedNaturally);
  active = null;
}

function appearsNaturallyCompleted(
  track: RntpTrack | undefined,
  position: number | undefined,
): boolean {
  return playbackAppearsNaturallyCompleted(
    finiteDuration(track?.duration),
    typeof position === 'number' ? position : -1,
  );
}

export function initializeListeningHistoryTracking(): void {
  enqueue(async () => {
    status = await AstraLibraryData.getListeningHistoryStatus<ListeningHistoryStatus>();
    const [track, playbackState] = await Promise.all([
      TrackPlayer.getActiveTrack(),
      TrackPlayer.getPlaybackState(),
    ]);
    isPlaying = playbackState.state === State.Playing;
    beginSession(track);
  });
}

export function handleListeningTrackChanged(event: PlaybackActiveTrackChangedEvent): void {
  enqueue(async () => {
    const now = Date.now();
    advance(now);
    const lastTrack = event.lastTrack;
    const wasManual = consumeManualRecentPlayTransition(
      lastTrack ? rntpToTrack(lastTrack).path : null,
      now,
    );
    const completedNaturally =
      !wasManual && appearsNaturallyCompleted(lastTrack, event.lastPosition);
    await closeSession(now, completedNaturally);
    if (!status?.enabled) {
      status = await AstraLibraryData.getListeningHistoryStatus<ListeningHistoryStatus>();
    }
    beginSession(event.track, now);
  });
}

export function handleListeningPlaybackState(nextState: State): void {
  enqueue(async () => {
    const now = Date.now();
    advance(now);
    const wasPlaying = isPlaying;
    isPlaying = nextState === State.Playing;

    if (nextState === State.Stopped || nextState === State.Ended || nextState === State.Error) {
      await closeSession(now, nextState === State.Ended);
      return;
    }
    if (wasPlaying && !isPlaying) await closeSegment(now);
    if (isPlaying) {
      if (!active) beginSession(await TrackPlayer.getActiveTrack(), now);
      beginSegment(now);
    }
  });
}

export function handleListeningProgress(position: number, duration: number): void {
  enqueue(async () => {
    const now = Date.now();
    if (!active) {
      beginSession(await TrackPlayer.getActiveTrack(), now);
    }
    if (!active) return;
    const nextDuration = finiteDuration(duration);
    if (nextDuration > 0) active.durationSeconds = nextDuration;
    advance(now);
    if (shouldCheckpoint(active)) await persist(now, false, false, false);
  });
}

export function handleListeningQueueEnded(position: number): void {
  enqueue(async () => {
    const now = Date.now();
    advance(now);
    const track = await TrackPlayer.getActiveTrack();
    await closeSession(now, appearsNaturallyCompleted(track, position));
  });
}

export async function pauseListeningHistoryTracking(): Promise<void> {
  enqueue(async () => {
    const now = Date.now();
    advance(now);
    await closeSession(now, false);
  });
  await operation;
}

export function resumeListeningHistoryTracking(): void {
  enqueue(async () => {
    status = await AstraLibraryData.getListeningHistoryStatus<ListeningHistoryStatus>();
    const [track, playbackState] = await Promise.all([
      TrackPlayer.getActiveTrack(),
      TrackPlayer.getPlaybackState(),
    ]);
    isPlaying = playbackState.state === State.Playing;
    beginSession(track);
  });
}

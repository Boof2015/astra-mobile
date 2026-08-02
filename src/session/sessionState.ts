import { normalizePlaybackSource } from '../audio/playbackSource.ts';
import type { PlaybackSource } from '../types/audio.ts';

export const MOBILE_SESSION_KIND = 'astra-mobile-session';
export const MOBILE_SESSION_SCHEMA_VERSION = 1;

const MAX_QUEUE_ITEMS = 100_000;
const MAX_PATH_LENGTH = 8192;
const MAX_POSITION_SECONDS = 30 * 24 * 60 * 60;

export type SessionRepeatMode = 'none' | 'one' | 'all';

export interface PlaybackSessionSnapshotV1 {
  queuePaths: string[];
  activeIndex: number;
  position: number;
  shuffle: boolean;
  repeat: SessionRepeatMode;
  originalOrderPaths: string[];
  /** Optional for backward compatibility with version-1 snapshots written before queue sources. */
  source?: PlaybackSource | null;
}

export interface MobileSessionSnapshotV1 {
  kind: typeof MOBILE_SESSION_KIND;
  schemaVersion: typeof MOBILE_SESSION_SCHEMA_VERSION;
  savedAt: number;
  playback: PlaybackSessionSnapshotV1 | null;
}

export interface SessionTrackLike {
  path: string;
  duration: number;
}

export interface ResolvedPlaybackSession<T extends SessionTrackLike> {
  tracks: T[];
  activeIndex: number;
  position: number;
  shuffle: boolean;
  repeat: SessionRepeatMode;
  originalOrderPaths: string[];
  source: PlaybackSource | null;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function finiteNumber(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function nonEmptyString(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > maxLength) return null;
  return trimmed;
}

function normalizePathArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const paths: string[] = [];
  for (const entry of value.slice(0, MAX_QUEUE_ITEMS)) {
    const path = nonEmptyString(entry, MAX_PATH_LENGTH);
    if (path) paths.push(path);
  }
  return paths;
}

function samePathMultiset(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const counts = new Map<string, number>();
  for (const path of a) counts.set(path, (counts.get(path) ?? 0) + 1);
  for (const path of b) {
    const count = counts.get(path) ?? 0;
    if (count <= 0) return false;
    if (count === 1) counts.delete(path);
    else counts.set(path, count - 1);
  }
  return counts.size === 0;
}

function normalizeRepeat(value: unknown): SessionRepeatMode {
  return value === 'one' || value === 'all' ? value : 'none';
}

export function normalizePlaybackSession(value: unknown): PlaybackSessionSnapshotV1 | null {
  if (!isPlainRecord(value)) return null;
  const queuePaths = normalizePathArray(value.queuePaths);
  if (queuePaths.length === 0) return null;

  const rawIndex = Math.trunc(finiteNumber(value.activeIndex));
  const activeIndex = Math.max(0, Math.min(queuePaths.length - 1, rawIndex));
  const position = Math.max(0, Math.min(MAX_POSITION_SECONDS, finiteNumber(value.position)));
  const candidateOriginalOrder = normalizePathArray(value.originalOrderPaths);
  const originalOrderPaths = samePathMultiset(candidateOriginalOrder, queuePaths)
    ? candidateOriginalOrder
    : [...queuePaths];

  return {
    queuePaths,
    activeIndex,
    position,
    shuffle: value.shuffle === true,
    repeat: normalizeRepeat(value.repeat),
    originalOrderPaths,
    source: normalizePlaybackSource(value.source),
  };
}

/**
 * Reads named fields only, so unknown ones are dropped. Snapshots written before
 * route restore was removed still carry a `lastStableHref` we deliberately
 * ignore — which is exactly why the schema version stays at 1. Bumping it would
 * make this return null for every existing install and discard their queue.
 */
export function normalizeMobileSessionSnapshot(value: unknown): MobileSessionSnapshotV1 | null {
  if (!isPlainRecord(value)) return null;
  if (value.kind !== MOBILE_SESSION_KIND || value.schemaVersion !== MOBILE_SESSION_SCHEMA_VERSION) {
    return null;
  }

  return {
    kind: MOBILE_SESSION_KIND,
    schemaVersion: MOBILE_SESSION_SCHEMA_VERSION,
    savedAt: Math.max(0, finiteNumber(value.savedAt)),
    playback: normalizePlaybackSession(value.playback),
  };
}

export function parseMobileSessionSnapshot(raw: string | null): MobileSessionSnapshotV1 | null {
  if (!raw) return null;
  try {
    return normalizeMobileSessionSnapshot(JSON.parse(raw));
  } catch {
    return null;
  }
}

export function stringifyMobileSessionSnapshot(snapshot: MobileSessionSnapshotV1): string {
  return JSON.stringify(snapshot);
}

/**
 * Re-resolves a saved path-only queue against today's library rows. Duplicate
 * queue entries remain duplicates; deleted paths are removed occurrence-wise.
 */
export function resolvePlaybackSession<T extends SessionTrackLike>(
  snapshot: PlaybackSessionSnapshotV1,
  libraryTracks: readonly T[]
): ResolvedPlaybackSession<T> | null {
  const byPath = new Map(libraryTracks.map((track) => [track.path, track]));
  const resolvedEntries = snapshot.queuePaths.flatMap((path, originalIndex) => {
    const track = byPath.get(path);
    return track ? [{ track, originalIndex }] : [];
  });
  if (resolvedEntries.length === 0) return null;

  let resolvedActiveIndex = resolvedEntries.findIndex(
    (entry) => entry.originalIndex === snapshot.activeIndex
  );
  const activeSurvived = resolvedActiveIndex >= 0;
  if (!activeSurvived) {
    resolvedActiveIndex = resolvedEntries.findIndex(
      (entry) => entry.originalIndex > snapshot.activeIndex
    );
    if (resolvedActiveIndex < 0) resolvedActiveIndex = resolvedEntries.length - 1;
  }

  const activeTrack = resolvedEntries[resolvedActiveIndex].track;
  const duration = Number.isFinite(activeTrack.duration) && activeTrack.duration > 0
    ? activeTrack.duration
    : 0;
  const position = activeSurvived
    ? Math.max(0, duration > 0 ? Math.min(snapshot.position, duration) : 0)
    : 0;

  const survivingPaths = new Set(byPath.keys());
  const originalOrderPaths = snapshot.originalOrderPaths.filter((path) => survivingPaths.has(path));
  const resolvedQueuePaths = resolvedEntries.map((entry) => entry.track.path);

  return {
    tracks: resolvedEntries.map((entry) => entry.track),
    activeIndex: resolvedActiveIndex,
    position,
    shuffle: snapshot.shuffle,
    repeat: snapshot.repeat,
    originalOrderPaths: samePathMultiset(originalOrderPaths, resolvedQueuePaths)
      ? originalOrderPaths
      : resolvedQueuePaths,
    source: snapshot.source ?? null,
  };
}

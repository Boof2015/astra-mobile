const legacyKeys = new WeakMap<object, string>();
let sequence = 0;

/** Every occurrence has its own ID, including two copies of the same song. */
export function queueEntryKey(track: { astraQueueSessionId?: unknown; astraQueueEntryId?: unknown; astraCarQueueEntryId?: unknown; id?: unknown; url: unknown }) {
  if (track.astraQueueSessionId != null && track.astraQueueEntryId != null) return `${track.astraQueueSessionId}:${track.astraQueueEntryId}`;
  if (track.astraCarQueueEntryId != null) return String(track.astraCarQueueEntryId);
  // Old in-memory snapshots still distinguish occurrences by object identity.
  let key = legacyKeys.get(track);
  if (!key) { key = `legacy:${++sequence}`; legacyKeys.set(track, key); }
  return key;
}

export function queueMoveTarget(position: number, direction: -1 | 1, active: number, total: number) {
  if (position <= active || position >= total) return position;
  return Math.max(active + 1, Math.min(total - 1, position + direction));
}

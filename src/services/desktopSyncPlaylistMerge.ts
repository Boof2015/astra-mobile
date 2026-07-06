// Pure playlist content comparison + union merge for desktop sync conflicts
// (node-testable, no RN imports). Entries are compared by the shared metadata
// identity key — the same identity favorites sync on.
// Runtime imports are relative with explicit .ts so this runs under
// `node --test`; type-only '@/' imports are erased by strip-types.

import type { SyncPlaylistEntry } from '@/types/desktopSync';
import { buildTrackSyncKey } from '../shared/sync/identity.ts';

export function playlistEntryKey(
  entry: Pick<SyncPlaylistEntry, 'title' | 'artist' | 'album'>
): string {
  return buildTrackSyncKey(entry.title, entry.artist, entry.album);
}

/** Same songs in the same order (by metadata identity). */
export function playlistEntriesEqual(a: SyncPlaylistEntry[], b: SyncPlaylistEntry[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (playlistEntryKey(a[i]) !== playlistEntryKey(b[i])) return false;
  }
  return true;
}

/**
 * Union merge: the newer side's entries keep their order, then the older
 * side's entries whose identity isn't already present are appended (in their
 * own order). Positions are renumbered; each entry keeps its origin metadata
 * (addedAt, sourcePath, duration).
 */
export function mergePlaylistEntries(
  newer: SyncPlaylistEntry[],
  older: SyncPlaylistEntry[]
): SyncPlaylistEntry[] {
  const merged: SyncPlaylistEntry[] = [];
  const seenKeys = new Set<string>();
  for (const entry of [...newer].sort((a, b) => a.position - b.position)) {
    const key = playlistEntryKey(entry);
    if (seenKeys.has(key)) continue;
    seenKeys.add(key);
    merged.push({ ...entry, position: merged.length });
  }
  for (const entry of [...older].sort((a, b) => a.position - b.position)) {
    const key = playlistEntryKey(entry);
    if (seenKeys.has(key)) continue;
    seenKeys.add(key);
    merged.push({ ...entry, position: merged.length });
  }
  return merged;
}

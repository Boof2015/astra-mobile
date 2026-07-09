// In-memory UI state for lyrics — one entry per track path, backed by the
// cache-first orchestrator (src/lyrics/lyrics.ts). The orchestrator already
// dedupes in-flight network work and persists to SQLite; this store adds the
// loading flag + last result the now-playing lyrics band renders, plus a small
// LRU cap so revisiting tracks stays instant without growing unbounded.

import { create } from 'zustand';
import { buildLyricsQuery, getLyricsForTrack } from '@/lyrics/lyrics';
import type { LyricsLookupResult } from '@/lyrics/types';
import type { Track } from '@/types/audio';

const MAX_ENTRIES = 64;

export interface LyricsUiEntry {
  loading: boolean;
  result: LyricsLookupResult | null;
}

interface LyricsStore {
  onlineEnabled: boolean;
  byPath: Record<string, LyricsUiEntry>;
  loadForTrack: (track: Track | null, options?: { force?: boolean }) => Promise<void>;
  setOnlineEnabled: (enabled: boolean) => void;
}

// Latest request id per path — guards against a stale response overwriting a
// newer one (e.g. rapid track changes reusing the same store entry).
const requestIds = new Map<string, number>();
let requestSeq = 0;

function pruneToLru(byPath: Record<string, LyricsUiEntry>): Record<string, LyricsUiEntry> {
  const keys = Object.keys(byPath);
  if (keys.length <= MAX_ENTRIES) return byPath;
  const next = { ...byPath };
  for (const key of keys.slice(0, keys.length - MAX_ENTRIES)) {
    delete next[key];
    requestIds.delete(key);
  }
  return next;
}

export const useLyricsStore = create<LyricsStore>((set, get) => ({
  onlineEnabled: true,
  byPath: {},

  loadForTrack: async (track, options = {}) => {
    if (!track?.path) return;
    const path = track.path;
    const force = Boolean(options.force);

    const existing = get().byPath[path];
    if (!force && existing && (existing.result || existing.loading)) return;

    const requestId = ++requestSeq;
    requestIds.set(path, requestId);

    const query = buildLyricsQuery(track);
    if (!query) {
      set((state) => ({
        byPath: pruneToLru({
          ...state.byPath,
          [path]: { loading: false, result: { status: 'not_found', reason: 'embedded-missing' } },
        }),
      }));
      return;
    }

    set((state) => ({
      byPath: pruneToLru({
        ...state.byPath,
        [path]: { loading: true, result: existing?.result ?? null },
      }),
    }));

    let result: LyricsLookupResult;
    try {
      result = await getLyricsForTrack(query, { forceRefresh: force, onlineEnabled: get().onlineEnabled });
    } catch (error) {
      result = {
        status: 'transient_error',
        message: error instanceof Error ? error.message : 'Lyrics lookup failed.',
      };
    }

    // Drop the response if a newer request for this path superseded it.
    if (requestIds.get(path) !== requestId) return;

    set((state) => ({
      byPath: pruneToLru({ ...state.byPath, [path]: { loading: false, result } }),
    }));
  },

  setOnlineEnabled: (enabled) => set({ onlineEnabled: enabled }),
}));

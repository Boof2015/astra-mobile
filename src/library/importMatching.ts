// Track matching ladders (pure — node-testable, no expo imports):
// - M3U import: exact content URI -> decoded SAF path -> file name (+
//   path-suffix overlap) -> metadata (title+artist -> title, unique-or-null).
// - Desktop sync: source-path file name -> title+artist+album (shared
//   whitespace-collapsing normalization) -> the M3U metadata rungs.
// Ported in spirit from the desktop playlist importer (library.ts).
// Runtime imports are relative (not '@/') so this module runs under plain
// `node --test`; type-only '@/' imports are erased by strip-types.

import type { DbTrack } from '@/types/library';
import type { M3uEntry } from '@/lib/m3u';
import { decodedSafDocumentPath } from './folderTree.ts';
import { normalizeSyncKeyPart } from '../shared/sync/identity.ts';

export const decodedDocPath = decodedSafDocumentPath;

interface IndexedTrack {
  track: DbTrack;
  /** Lowercased decoded SAF path, for suffix-overlap scoring. */
  decodedPath: string | null;
}

export interface ImportMatchIndex {
  byContentUri: Map<string, DbTrack>;
  byDecodedPath: Map<string, DbTrack>;
  byFileName: Map<string, IndexedTrack[]>;
  /** Metadata maps are unique-or-null: null marks a collision (ambiguous). */
  byTitleArtist: Map<string, DbTrack | null>;
  byTitle: Map<string, DbTrack | null>;
  /** Desktop-sync rung, keyed with the shared whitespace-collapsing
   *  normalization (normalizeSyncKeyPart) unlike the M3U maps above. */
  byTitleArtistAlbum: Map<string, DbTrack | null>;
}

function upsertUnique(map: Map<string, DbTrack | null>, key: string, track: DbTrack): void {
  if (!key) return;
  map.set(key, map.has(key) ? null : track);
}

export function buildImportIndex(tracks: DbTrack[]): ImportMatchIndex {
  const index: ImportMatchIndex = {
    byContentUri: new Map(),
    byDecodedPath: new Map(),
    byFileName: new Map(),
    byTitleArtist: new Map(),
    byTitle: new Map(),
    byTitleArtistAlbum: new Map(),
  };
  for (const track of tracks) {
    index.byContentUri.set(track.path, track);

    const decoded = decodedDocPath(track.path)?.toLocaleLowerCase() ?? null;
    if (decoded && !index.byDecodedPath.has(decoded)) {
      index.byDecodedPath.set(decoded, track);
    }

    const fileName = track.file_name.toLocaleLowerCase();
    const bucket = index.byFileName.get(fileName);
    if (bucket) {
      bucket.push({ track, decodedPath: decoded });
    } else {
      index.byFileName.set(fileName, [{ track, decodedPath: decoded }]);
    }

    const title = track.title.trim().toLocaleLowerCase();
    const artist = track.artist.trim().toLocaleLowerCase();
    upsertUnique(index.byTitleArtist, `${title}\n${artist}`, track);
    upsertUnique(index.byTitle, title, track);

    const syncTitle = normalizeSyncKeyPart(track.title);
    if (syncTitle) {
      upsertUnique(
        index.byTitleArtistAlbum,
        `${syncTitle}\n${normalizeSyncKeyPart(track.artist)}\n${normalizeSyncKeyPart(track.album)}`,
        track
      );
    }
  }
  return index;
}

/** Foreign playlist paths: strip file://, unify slashes, percent-decode. */
export function normalizeEntryPath(path: string): string {
  let value = path.trim().replace(/\\/g, '/');
  if (/^file:\/\//i.test(value)) value = value.slice('file://'.length);
  if (value.includes('%')) {
    try {
      value = decodeURIComponent(value);
    } catch {
      // keep the raw value
    }
  }
  return value;
}

export type ImportMatch =
  | { kind: 'matched'; track: DbTrack; via: 'path' | 'metadata' }
  | { kind: 'ambiguous' }
  | { kind: 'none' };

/** Trailing path-segment overlap between an entry path and a track's decoded path. */
function suffixOverlap(entrySegments: string[], decodedPath: string | null): number {
  if (!decodedPath) return 1; // file name matched, nothing more to compare
  const trackSegments = decodedPath.split('/');
  let overlap = 0;
  while (
    overlap < entrySegments.length &&
    overlap < trackSegments.length &&
    entrySegments[entrySegments.length - 1 - overlap] ===
      trackSegments[trackSegments.length - 1 - overlap]
  ) {
    overlap += 1;
  }
  return overlap;
}

export function matchImportEntry(entry: M3uEntry, index: ImportMatchIndex): ImportMatch {
  const raw = entry.path.trim();

  // 1. Exact SAF content URI (our own exports never write these, but be safe).
  const exact = index.byContentUri.get(raw);
  if (exact) return { kind: 'matched', track: exact, via: 'path' };

  const normalized = normalizeEntryPath(raw).toLocaleLowerCase();

  // 2. Decoded SAF path ("Music/Artist/Album/file.flac" — our export format).
  const byPath = index.byDecodedPath.get(normalized);
  if (byPath) return { kind: 'matched', track: byPath, via: 'path' };

  // 3. File name bucket, disambiguated by longest trailing-segment overlap.
  const entrySegments = normalized.split('/');
  const fileName = entrySegments[entrySegments.length - 1];
  const candidates = index.byFileName.get(fileName) ?? [];
  if (candidates.length === 1) {
    return { kind: 'matched', track: candidates[0].track, via: 'path' };
  }
  if (candidates.length > 1) {
    let best: IndexedTrack | null = null;
    let bestScore = 0;
    let tied = false;
    for (const candidate of candidates) {
      const score = suffixOverlap(entrySegments, candidate.decodedPath);
      if (score > bestScore) {
        best = candidate;
        bestScore = score;
        tied = false;
      } else if (score === bestScore) {
        tied = true;
      }
    }
    if (best && !tied) return { kind: 'matched', track: best.track, via: 'path' };
    return { kind: 'ambiguous' };
  }

  // 4. Metadata from EXTINF: title+artist, then title (unique-or-null).
  const title = entry.title?.trim().toLocaleLowerCase();
  if (title) {
    const artist = entry.artist?.trim().toLocaleLowerCase();
    if (artist) {
      const hit = index.byTitleArtist.get(`${title}\n${artist}`);
      if (hit) return { kind: 'matched', track: hit, via: 'metadata' };
      if (hit === null) return { kind: 'ambiguous' };
    }
    const hit = index.byTitle.get(title);
    if (hit) return { kind: 'matched', track: hit, via: 'metadata' };
    if (hit === null) return { kind: 'ambiguous' };
  }

  return { kind: 'none' };
}

export interface SyncEntryQuery {
  title: string;
  artist: string;
  album: string;
  /** The peer's file path, useful only for its file name / trailing segments. */
  sourcePath?: string | null;
}

/**
 * Desktop-sync matching ladder: source-path file name (unique or best
 * suffix-overlap) -> title+artist+album -> title+artist -> title. Unlike M3U
 * import, sync entries always carry metadata, so an ambiguous file-name rung
 * falls through to metadata instead of giving up.
 */
export function matchSyncEntry(query: SyncEntryQuery, index: ImportMatchIndex): ImportMatch {
  const sourcePath = query.sourcePath?.trim();
  if (sourcePath) {
    const normalized = normalizeEntryPath(sourcePath).toLocaleLowerCase();
    const entrySegments = normalized.split('/');
    const fileName = entrySegments[entrySegments.length - 1];
    const candidates = index.byFileName.get(fileName) ?? [];
    if (candidates.length === 1) {
      return { kind: 'matched', track: candidates[0].track, via: 'path' };
    }
    if (candidates.length > 1) {
      let best: DbTrack | null = null;
      let bestScore = 0;
      let tied = false;
      for (const candidate of candidates) {
        const score = suffixOverlap(entrySegments, candidate.decodedPath);
        if (score > bestScore) {
          best = candidate.track;
          bestScore = score;
          tied = false;
        } else if (score === bestScore) {
          tied = true;
        }
      }
      if (best && !tied) return { kind: 'matched', track: best, via: 'path' };
    }
  }

  const title = normalizeSyncKeyPart(query.title);
  if (!title) return { kind: 'none' };
  const artist = normalizeSyncKeyPart(query.artist);
  const album = normalizeSyncKeyPart(query.album);

  if (artist && album) {
    const hit = index.byTitleArtistAlbum.get(`${title}\n${artist}\n${album}`);
    if (hit) return { kind: 'matched', track: hit, via: 'metadata' };
    if (hit === null) return { kind: 'ambiguous' };
  }

  // The M3U maps use plain trim+lowercase keys — query them the same way.
  const m3uTitle = query.title.trim().toLocaleLowerCase();
  const m3uArtist = query.artist.trim().toLocaleLowerCase();
  if (m3uArtist) {
    const hit = index.byTitleArtist.get(`${m3uTitle}\n${m3uArtist}`);
    if (hit) return { kind: 'matched', track: hit, via: 'metadata' };
    if (hit === null) return { kind: 'ambiguous' };
  }
  const hit = index.byTitle.get(m3uTitle);
  if (hit) return { kind: 'matched', track: hit, via: 'metadata' };
  if (hit === null) return { kind: 'ambiguous' };

  return { kind: 'none' };
}

// M3U file IO (SAF export, document-picker import) + the import matching
// ladder: exact content URI -> decoded SAF path -> file name (+ path-suffix
// overlap) -> metadata (title+artist -> title, unique-or-null), ported in
// spirit from the desktop playlist importer.

import * as DocumentPicker from 'expo-document-picker';
import {
  StorageAccessFramework,
  readAsStringAsync,
  writeAsStringAsync,
} from 'expo-file-system/legacy';
import type { DbTrack } from '@/types/library';
import { parseM3u, serializeM3u, type M3uEntry, type M3uExportEntry } from '@/lib/m3u';

/** "content://…/document/primary%3AMusic%2FA%2Ff.flac" -> "Music/A/f.flac" */
export function decodedDocPath(contentUri: string): string | null {
  const marker = '/document/';
  const idx = contentUri.indexOf(marker);
  if (idx < 0) return null;
  let docId: string;
  try {
    docId = decodeURIComponent(contentUri.slice(idx + marker.length));
  } catch {
    return null;
  }
  const colon = docId.indexOf(':');
  return colon >= 0 ? docId.slice(colon + 1) : docId;
}

// --- Import matching ---------------------------------------------------------

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

// --- File IO -------------------------------------------------------------------

function sanitizeFileName(name: string): string {
  const cleaned = name.replace(/[\\/:*?"<>|]/g, '_').trim();
  return cleaned || 'Playlist';
}

export interface M3uExportResult {
  fileUri: string;
  entryCount: number;
}

/** Folder picker -> create .m3u8 -> write. Returns null if the picker is cancelled. */
export async function exportPlaylistM3u(
  name: string,
  entries: M3uExportEntry[]
): Promise<M3uExportResult | null> {
  const permission = await StorageAccessFramework.requestDirectoryPermissionsAsync();
  if (!permission.granted) return null;

  const fileUri = await StorageAccessFramework.createFileAsync(
    permission.directoryUri,
    `${sanitizeFileName(name)}.m3u8`,
    // Matches the .m3u8 extension so SAF doesn't append another one.
    'application/vnd.apple.mpegurl'
  );
  await writeAsStringAsync(fileUri, serializeM3u(entries));
  return { fileUri, entryCount: entries.length };
}

/** Document picker -> parse. Returns null on cancel; throws on a non-M3U pick. */
export async function pickAndParseM3u(): Promise<{ name: string; entries: M3uEntry[] } | null> {
  const result = await DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true });
  if (result.canceled || result.assets.length === 0) return null;

  const asset = result.assets[0];
  // M3U mime types are unreliable across file managers — validate by name.
  if (!/\.m3u8?$/i.test(asset.name)) {
    throw new Error(`"${asset.name}" is not an .m3u/.m3u8 playlist`);
  }
  const content = await readAsStringAsync(asset.uri);
  const name = asset.name.replace(/\.m3u8?$/i, '').trim() || 'Imported playlist';
  return { name, entries: parseM3u(content) };
}

// Lyrics cache — LRC/XLRC results from online lookup, mirroring the waveform
// cache (src/db/waveformQueries.ts): keyed by track_path with no FK, upserted
// with ON CONFLICT. A row is returned only when its metadata_signature still
// matches the current track tags, so a retag re-fetches. Parsed lines are stored
// as JSON and re-sanitized on read.

import type { LibraryDatabase } from './database';
import { sanitizeLyricsLines } from '@/lyrics/parsing';
import type { LyricsFormat, LyricsLine, LyricsProvider, LyricsSource } from '@/lyrics/types';

export interface LyricsCacheEntry {
  status: 'hit' | 'not_found';
  source: LyricsSource;
  provider: LyricsProvider | null;
  format: LyricsFormat;
  plainLyrics: string | null;
  syncedLyrics: string | null;
  syncedLines: LyricsLine[];
}

export interface LyricsCacheWrite {
  trackPath: string;
  metadataSignature: string;
  status: 'hit' | 'not_found';
  source: LyricsSource | null;
  provider: LyricsProvider | null;
  format: LyricsFormat | null;
  plainLyrics: string | null;
  syncedLyrics: string | null;
  syncedLines: LyricsLine[];
}

interface LyricsCacheRow {
  metadata_signature: string | null;
  status: string;
  source: string | null;
  provider: string | null;
  format: string | null;
  plain_lyrics: string | null;
  synced_lyrics: string | null;
  synced_lines_json: string;
}

function parseSyncedLines(json: string): LyricsLine[] {
  try {
    return sanitizeLyricsLines(JSON.parse(json));
  } catch {
    return [];
  }
}

export async function getLyricsCache(
  db: LibraryDatabase,
  trackPath: string,
  metadataSignature: string
): Promise<LyricsCacheEntry | null> {
  const row = await db.get<LyricsCacheRow>(
    `SELECT metadata_signature, status, source, provider, format, plain_lyrics, synced_lyrics, synced_lines_json
       FROM lyrics_cache WHERE track_path = ?`,
    [trackPath]
  );
  if (!row) return null;
  // A metadata change (retag) invalidates the cached result.
  if (row.metadata_signature !== metadataSignature) return null;

  return {
    status: row.status === 'hit' ? 'hit' : 'not_found',
    source: (row.source as LyricsSource | null) ?? 'lrclib',
    provider: (row.provider as LyricsProvider | null) ?? null,
    format: (row.format as LyricsFormat | null) ?? 'plain',
    plainLyrics: row.plain_lyrics,
    syncedLyrics: row.synced_lyrics,
    syncedLines: parseSyncedLines(row.synced_lines_json),
  };
}

export async function putLyricsCache(db: LibraryDatabase, entry: LyricsCacheWrite): Promise<void> {
  await db.run(
    `INSERT INTO lyrics_cache (
       track_path, metadata_signature, status, source, provider, format,
       plain_lyrics, synced_lyrics, synced_lines_json, updated_at
     )
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(track_path) DO UPDATE SET
       metadata_signature = excluded.metadata_signature,
       status = excluded.status,
       source = excluded.source,
       provider = excluded.provider,
       format = excluded.format,
       plain_lyrics = excluded.plain_lyrics,
       synced_lyrics = excluded.synced_lyrics,
       synced_lines_json = excluded.synced_lines_json,
       updated_at = excluded.updated_at`,
    [
      entry.trackPath,
      entry.metadataSignature,
      entry.status,
      entry.source,
      entry.provider,
      entry.format,
      entry.plainLyrics,
      entry.syncedLyrics,
      JSON.stringify(entry.syncedLines),
      Date.now(),
    ]
  );
}

export async function getLyricsCacheCount(db: LibraryDatabase): Promise<number> {
  const row = await db.get<{ count: number }>('SELECT COUNT(*) AS count FROM lyrics_cache');
  return row?.count ?? 0;
}

export async function deleteLyricsCache(db: LibraryDatabase, trackPath: string): Promise<void> {
  await db.run('DELETE FROM lyrics_cache WHERE track_path = ?', [trackPath]);
}

export async function clearLyricsCache(db: LibraryDatabase): Promise<void> {
  await db.run('DELETE FROM lyrics_cache');
}

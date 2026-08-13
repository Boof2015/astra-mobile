// Lyrics cache — LRC/XLRC results from online lookup, mirroring the waveform
// cache (src/db/waveformQueries.ts): keyed by track_path with no FK, upserted
// with ON CONFLICT. A row is returned only when its metadata_signature still
// matches the current track tags, so a retag re-fetches. Parsed lines are stored
// as JSON and re-sanitized on read.

import { AstraLibraryData } from '../../modules/astra-library-scanner';
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
  status: string;
  source: string | null;
  provider: string | null;
  format: string | null;
  plainLyrics: string | null;
  syncedLyrics: string | null;
  syncedLinesJson: string;
}

function parseSyncedLines(json: string): LyricsLine[] {
  try {
    return sanitizeLyricsLines(JSON.parse(json));
  } catch {
    return [];
  }
}

export async function getLyricsCache(
  trackPath: string,
  metadataSignature: string
): Promise<LyricsCacheEntry | null> {
  const row = await AstraLibraryData.getLyrics<LyricsCacheRow>(trackPath, metadataSignature);
  if (!row) return null;

  return {
    status: row.status === 'hit' ? 'hit' : 'not_found',
    source: (row.source as LyricsSource | null) ?? 'lrclib',
    provider: (row.provider as LyricsProvider | null) ?? null,
    format: (row.format as LyricsFormat | null) ?? 'plain',
    plainLyrics: row.plainLyrics,
    syncedLyrics: row.syncedLyrics,
    syncedLines: parseSyncedLines(row.syncedLinesJson),
  };
}

export async function putLyricsCache(entry: LyricsCacheWrite): Promise<void> {
  await AstraLibraryData.putLyrics(entry.trackPath, {
    metadataSignature: entry.metadataSignature,
    status: entry.status,
    source: entry.source,
    provider: entry.provider,
    format: entry.format,
    plainLyrics: entry.plainLyrics,
    syncedLyrics: entry.syncedLyrics,
    syncedLinesJson: JSON.stringify(entry.syncedLines),
  });
}

export async function getLyricsCacheCount(): Promise<number> {
  return AstraLibraryData.countLyrics();
}

export async function deleteLyricsCache(trackPath: string): Promise<void> {
  await AstraLibraryData.deleteLyrics(trackPath);
}

export async function clearLyricsCache(): Promise<void> {
  await AstraLibraryData.clearLyrics();
}

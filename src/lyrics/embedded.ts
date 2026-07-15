import type { EmbeddedLyricsReadResult } from '../../modules/astra-library-scanner';
import {
  createLyricsPayload,
  parseLyricsText,
  sanitizeLyricsLines,
  toPlainLyricsFromLines,
} from './parsing.ts';
import type { LyricsPayload } from './types';

export type EmbeddedLyricsResolution =
  | { status: 'hit'; lyrics: LyricsPayload }
  | { status: 'missing' | 'unavailable' | 'not_local' };

/** Pure bridge adapter kept separate from the native module for Node tests. */
export function createEmbeddedLyricsPayload(
  result: Extract<EmbeddedLyricsReadResult, { status: 'hit' }>
): LyricsPayload | null {
  const parsedText = result.text
    ? parseLyricsText(result.text, 'embedded', 'lrc')
    : null;
  const syncedLines = sanitizeLyricsLines(result.syncText.map((entry) => ({
    timestampMs: entry.timestampMs,
    text: entry.text,
  })));

  if (syncedLines.length === 0) return parsedText;

  return createLyricsPayload(
    'embedded',
    null,
    'lrc',
    parsedText?.plainLyrics ?? toPlainLyricsFromLines(syncedLines),
    null,
    syncedLines
  );
}

export function isLocalLyricsPath(path: string): boolean {
  return path.startsWith('content://') || path.startsWith('file://');
}

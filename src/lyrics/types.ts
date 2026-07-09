// Lyrics data contract — ported field-for-field from desktop
// (astra/src/types/lyrics.ts) so the parsing/presentation logic ports cleanly.
// v1 covers online lookup (xlrcdb + lrclib) + a fullscreen synced view. The
// 'manual'/'embedded'/'lrc'/'xlrc' sources exist for label parity and the v2
// local/embedded phase, even though v1 only produces 'xlrcdb'/'lrclib'.

export type LyricsProvider = 'lrclib' | 'xlrcdb';
export type LyricsSource = 'embedded' | 'lrclib' | 'manual' | 'lrc' | 'xlrc' | 'xlrcdb';
export type LyricsFormat = 'plain' | 'lrc' | 'xlrc';

export interface LyricsFurigana {
  start: number;
  end: number;
  base: string;
  reading: string;
}

export interface LyricsWord {
  timestampMs: number;
  text: string;
  furigana?: LyricsFurigana[];
}

export interface LyricsTranslation {
  lang: string;
  text: string;
}

export interface LyricsLine {
  timestampMs: number;
  text: string;
  kind?: 'silence';
  words?: LyricsWord[];
  furigana?: LyricsFurigana[];
  translations?: LyricsTranslation[];
  voice?: string | null;
}

export interface LyricsTrackQuery {
  path: string;
  title: string;
  artist: string;
  album?: string;
  durationSeconds?: number;
}

export interface LyricsPayload {
  source: LyricsSource;
  provider: LyricsProvider | null;
  format: LyricsFormat;
  plainLyrics: string | null;
  syncedLyrics: string | null;
  syncedLines: LyricsLine[];
}

export type LyricsLookupResult =
  | { status: 'hit'; lyrics: LyricsPayload; cached: boolean }
  | {
      status: 'not_found';
      reason: 'embedded-missing' | 'online-disabled' | 'provider-not-found' | 'provider-unavailable';
    }
  | { status: 'transient_error'; message: string; code?: string };

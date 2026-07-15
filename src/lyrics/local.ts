// Local lyrics sources (v2) — sidecar files + embedded tags, read through the
// native scanner module and parsed by the shared JS parser. Both are no-ops for
// non-local (remote / streaming) tracks. Sidecar wins over embedded, and both win
// over online lookup (see the orchestrator ordering in lyrics.ts).

import { AstraLibraryScanner } from '../../modules/astra-library-scanner';
import {
  createEmbeddedLyricsPayload,
  isLocalLyricsPath,
  type EmbeddedLyricsResolution,
} from './embedded';
import { parseLyricsText } from './parsing';
import type { LyricsPayload } from './types';

/** Resolve a sibling `<name>.xlrc`/`.lrc` next to a local track. */
export async function resolveSidecarLyrics(trackPath: string): Promise<LyricsPayload | null> {
  if (!isLocalLyricsPath(trackPath)) return null;
  try {
    const sidecar = await AstraLibraryScanner.readSidecarLyrics(trackPath);
    if (!sidecar?.text) return null;
    const source = sidecar.format === 'xlrc' ? 'xlrc' : 'lrc';
    return parseLyricsText(sidecar.text, source, sidecar.format);
  } catch {
    return null;
  }
}

/** Resolve embedded lyrics from a local track while preserving miss vs I/O failure. */
export async function resolveEmbeddedLyrics(trackPath: string): Promise<EmbeddedLyricsResolution> {
  if (!isLocalLyricsPath(trackPath)) return { status: 'not_local' };
  try {
    const embedded = await AstraLibraryScanner.readEmbeddedLyrics(trackPath);
    if (embedded.status !== 'hit') return embedded;
    const lyrics = createEmbeddedLyricsPayload(embedded);
    return lyrics ? { status: 'hit', lyrics } : { status: 'missing' };
  } catch {
    return { status: 'unavailable' };
  }
}

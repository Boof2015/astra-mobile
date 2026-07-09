// Local lyrics sources (v2) — sidecar files + embedded tags, read through the
// native scanner module and parsed by the shared JS parser. Both are no-ops for
// non-local (remote / streaming) tracks. Sidecar wins over embedded, and both win
// over online lookup (see the orchestrator ordering in lyrics.ts).

import { AstraLibraryScanner } from '../../modules/astra-library-scanner';
import { parseLyricsText } from './parsing';
import type { LyricsPayload } from './types';

function isLocalPath(path: string): boolean {
  return path.startsWith('content://') || path.startsWith('file://');
}

/** Resolve a sibling `<name>.xlrc`/`.lrc` next to a local track. */
export async function resolveSidecarLyrics(trackPath: string): Promise<LyricsPayload | null> {
  if (!isLocalPath(trackPath)) return null;
  try {
    const sidecar = await AstraLibraryScanner.readSidecarLyrics(trackPath);
    if (!sidecar?.text) return null;
    const source = sidecar.format === 'xlrc' ? 'xlrc' : 'lrc';
    return parseLyricsText(sidecar.text, source, sidecar.format);
  } catch {
    return null;
  }
}

/** Resolve embedded lyrics (Vorbis LYRICS/etc.) from a local track's container. */
export async function resolveEmbeddedLyrics(trackPath: string): Promise<LyricsPayload | null> {
  if (!isLocalPath(trackPath)) return null;
  try {
    const embedded = await AstraLibraryScanner.readEmbeddedLyrics(trackPath);
    if (!embedded?.text) return null;
    // Parse as LRC so timestamped tags become synced; plain text stays plain.
    return parseLyricsText(embedded.text, 'embedded', 'lrc');
  } catch {
    return null;
  }
}

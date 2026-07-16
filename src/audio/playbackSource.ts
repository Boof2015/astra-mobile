import type { PlaybackSource, PlaybackSourceKind } from '../types/audio.ts';

const MAX_PLAYBACK_SOURCE_LABEL_LENGTH = 256;
const PLAYBACK_SOURCE_KINDS = new Set<PlaybackSourceKind>([
  'album',
  'artist',
  'playlist',
  'favorites',
  'library',
  'folder',
  'recently-played',
  'search',
  'signal',
  'android-auto',
  'sample',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/** Validates persisted playback context without trusting arbitrary session JSON. */
export function normalizePlaybackSource(value: unknown): PlaybackSource | null {
  if (!isRecord(value)) return null;
  if (typeof value.kind !== 'string' || !PLAYBACK_SOURCE_KINDS.has(value.kind as PlaybackSourceKind)) {
    return null;
  }
  if (typeof value.label !== 'string') return null;
  const label = value.label.trim();
  if (!label || label.length > MAX_PLAYBACK_SOURCE_LABEL_LENGTH) return null;
  return { kind: value.kind as PlaybackSourceKind, label };
}

export const MOBILE_SESSION_KIND = 'astra-mobile-session';
export const MOBILE_SESSION_SCHEMA_VERSION = 1;

const MAX_QUEUE_ITEMS = 100_000;
const MAX_PATH_LENGTH = 8192;
const MAX_HREF_LENGTH = 4096;
const MAX_POSITION_SECONDS = 30 * 24 * 60 * 60;

export type SessionRepeatMode = 'none' | 'one' | 'all';

export interface PlaybackSessionSnapshotV1 {
  queuePaths: string[];
  activeIndex: number;
  position: number;
  shuffle: boolean;
  repeat: SessionRepeatMode;
  originalOrderPaths: string[];
}

export interface MobileSessionSnapshotV1 {
  kind: typeof MOBILE_SESSION_KIND;
  schemaVersion: typeof MOBILE_SESSION_SCHEMA_VERSION;
  savedAt: number;
  lastStableHref: string;
  playback: PlaybackSessionSnapshotV1 | null;
}

export interface SessionTrackLike {
  path: string;
  duration: number;
}

export interface ResolvedPlaybackSession<T extends SessionTrackLike> {
  tracks: T[];
  activeIndex: number;
  position: number;
  shuffle: boolean;
  repeat: SessionRepeatMode;
  originalOrderPaths: string[];
}

export interface StableRouteValidationContext {
  hasAlbum: (identityKey: string) => boolean;
  hasArtist: (name: string, credit: boolean) => boolean;
  hasPlaylist: (id: number) => boolean;
}

const STATIC_STABLE_PATHS = new Set([
  '/',
  '/library',
  '/eq',
  '/settings',
  '/recently-played',
  '/settings/appearance',
  '/settings/library',
  '/settings/audio',
  '/settings/services',
  '/settings/experimental',
  '/settings/info',
  '/settings/haptics-lab',
  '/sources',
  '/lastfm',
  '/desktop-remote',
  '/desktop-sync',
]);

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function finiteNumber(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function nonEmptyString(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > maxLength) return null;
  return trimmed;
}

function normalizePathArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const paths: string[] = [];
  for (const entry of value.slice(0, MAX_QUEUE_ITEMS)) {
    const path = nonEmptyString(entry, MAX_PATH_LENGTH);
    if (path) paths.push(path);
  }
  return paths;
}

function samePathMultiset(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const counts = new Map<string, number>();
  for (const path of a) counts.set(path, (counts.get(path) ?? 0) + 1);
  for (const path of b) {
    const count = counts.get(path) ?? 0;
    if (count <= 0) return false;
    if (count === 1) counts.delete(path);
    else counts.set(path, count - 1);
  }
  return counts.size === 0;
}

function normalizeRepeat(value: unknown): SessionRepeatMode {
  return value === 'one' || value === 'all' ? value : 'none';
}

function decodeRoutePart(value: string): string | null {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

/**
 * Canonicalizes routes that are safe to restore after a cold launch. Transient
 * editors, scanners, import/redirect routes, and unknown future routes return
 * null so the previously remembered stable page remains authoritative.
 */
export function normalizeStableHref(value: unknown): string | null {
  const href = nonEmptyString(value, MAX_HREF_LENGTH);
  if (!href || !href.startsWith('/') || href.startsWith('//') || href.includes('\\')) return null;

  const hashless = href.split('#', 1)[0] ?? '';
  const queryIndex = hashless.indexOf('?');
  const rawPath = queryIndex >= 0 ? hashless.slice(0, queryIndex) : hashless;
  const rawQuery = queryIndex >= 0 ? hashless.slice(queryIndex + 1) : '';
  const path = rawPath.length > 1 ? rawPath.replace(/\/+$/, '') : rawPath;

  if (!path || path.includes('//') || /%5c/i.test(path)) return null;
  const decodedSegments = path.split('/').slice(1).map(decodeRoutePart);
  if (decodedSegments.some(
    (segment) => segment === null || segment === '.' || segment === '..' || segment.includes('\\')
  )) {
    return null;
  }

  if (STATIC_STABLE_PATHS.has(path)) return path;
  if (/^\/library\/album\/[^/]+$/.test(path)) return path;
  if (/^\/library\/playlist\/(?:favorites|\d+)$/.test(path)) return path;

  if (/^\/library\/artist\/[^/]+(?:\/(?:albums|songs|appearances))?$/.test(path)) {
    const hasCredit = rawQuery
      .split('&')
      .map((part) => part.split('=', 2).map(decodeRoutePart))
      .some(([key, entry]) => key === 'credit' && entry === '1');
    return hasCredit ? `${path}?credit=1` : path;
  }

  return null;
}

export function validateRestoredHref(
  href: string,
  context: StableRouteValidationContext
): string {
  const normalized = normalizeStableHref(href) ?? '/';
  const [pathname, query = ''] = normalized.split('?', 2);

  const albumMatch = pathname.match(/^\/library\/album\/([^/]+)$/);
  if (albumMatch) {
    const key = decodeRoutePart(albumMatch[1]);
    return key && context.hasAlbum(key) ? normalized : '/library';
  }

  const artistMatch = pathname.match(
    /^\/library\/artist\/([^/]+)(?:\/(?:albums|songs|appearances))?$/
  );
  if (artistMatch) {
    const name = decodeRoutePart(artistMatch[1]);
    const credit = new URLSearchParams(query).get('credit') === '1';
    return name && context.hasArtist(name, credit) ? normalized : '/library';
  }

  const playlistMatch = pathname.match(/^\/library\/playlist\/(favorites|\d+)$/);
  if (playlistMatch) {
    if (playlistMatch[1] === 'favorites') return normalized;
    return context.hasPlaylist(Number(playlistMatch[1])) ? normalized : '/library';
  }

  return normalized;
}

function firstRouteParam(value: unknown): string | null {
  const entry = Array.isArray(value) ? value[0] : value;
  return typeof entry === 'string' && entry.length > 0 ? entry : null;
}

/** Builds an encoded href from Expo Router's file segments and decoded params. */
export function stableHrefForRoute(
  segments: readonly string[],
  pathname: string,
  params: Record<string, unknown>
): string {
  const routeSegments = segments.filter(
    (segment) => !(segment.startsWith('(') && segment.endsWith(')'))
  );
  const key = firstRouteParam(params.key);
  if (routeSegments.join('/') === 'library/album/[key]' && key) {
    return `/library/album/${encodeURIComponent(key)}`;
  }

  const name = firstRouteParam(params.name);
  if (
    name
    && routeSegments[0] === 'library'
    && routeSegments[1] === 'artist'
    && routeSegments[2] === '[name]'
  ) {
    const subpage = routeSegments[3];
    const suffix = subpage === 'albums' || subpage === 'songs' || subpage === 'appearances'
      ? `/${subpage}`
      : '';
    const credit = firstRouteParam(params.credit) === '1' ? '?credit=1' : '';
    return `/library/artist/${encodeURIComponent(name)}${suffix}${credit}`;
  }

  const id = firstRouteParam(params.id);
  if (routeSegments.join('/') === 'library/playlist/[id]' && id) {
    return `/library/playlist/${encodeURIComponent(id)}`;
  }

  return pathname;
}

/** Whether an initial OS URL names a destination that must beat disk restore. */
export function hasExplicitLaunchDestination(value: string | null): boolean {
  if (!value) return false;
  try {
    const url = new URL(value);
    let path = url.pathname || '';
    if (url.protocol === 'astra:' && url.hostname) path = `/${url.hostname}${path}`;
    const expoMarker = path.indexOf('/--/');
    if (expoMarker >= 0) path = path.slice(expoMarker + 3);
    return path !== '' && path !== '/';
  } catch {
    // A non-empty URL we cannot parse is still an explicit external launch.
    return true;
  }
}

/** Whether restart navigation may replace the router's initial destination. */
export function shouldRestoreSavedRoute(
  initialPathname: string,
  initialUrl: string | null
): boolean {
  if (hasExplicitLaunchDestination(initialUrl)) return false;
  if (initialPathname === '/') return true;
  if (initialPathname === '/notification.click' || initialPathname === '/eq/import') {
    return false;
  }
  // Stable non-root routes are initial deep-link/widget destinations when the
  // URL has already been consumed by Expo Router. Transient editor/scanner
  // state is never allowed to beat the last stable disk route.
  return normalizeStableHref(initialPathname) === null;
}

export function normalizePlaybackSession(value: unknown): PlaybackSessionSnapshotV1 | null {
  if (!isPlainRecord(value)) return null;
  const queuePaths = normalizePathArray(value.queuePaths);
  if (queuePaths.length === 0) return null;

  const rawIndex = Math.trunc(finiteNumber(value.activeIndex));
  const activeIndex = Math.max(0, Math.min(queuePaths.length - 1, rawIndex));
  const position = Math.max(0, Math.min(MAX_POSITION_SECONDS, finiteNumber(value.position)));
  const candidateOriginalOrder = normalizePathArray(value.originalOrderPaths);
  const originalOrderPaths = samePathMultiset(candidateOriginalOrder, queuePaths)
    ? candidateOriginalOrder
    : [...queuePaths];

  return {
    queuePaths,
    activeIndex,
    position,
    shuffle: value.shuffle === true,
    repeat: normalizeRepeat(value.repeat),
    originalOrderPaths,
  };
}

export function normalizeMobileSessionSnapshot(value: unknown): MobileSessionSnapshotV1 | null {
  if (!isPlainRecord(value)) return null;
  if (value.kind !== MOBILE_SESSION_KIND || value.schemaVersion !== MOBILE_SESSION_SCHEMA_VERSION) {
    return null;
  }

  return {
    kind: MOBILE_SESSION_KIND,
    schemaVersion: MOBILE_SESSION_SCHEMA_VERSION,
    savedAt: Math.max(0, finiteNumber(value.savedAt)),
    lastStableHref: normalizeStableHref(value.lastStableHref) ?? '/',
    playback: normalizePlaybackSession(value.playback),
  };
}

export function parseMobileSessionSnapshot(raw: string | null): MobileSessionSnapshotV1 | null {
  if (!raw) return null;
  try {
    return normalizeMobileSessionSnapshot(JSON.parse(raw));
  } catch {
    return null;
  }
}

export function stringifyMobileSessionSnapshot(snapshot: MobileSessionSnapshotV1): string {
  return JSON.stringify(snapshot);
}

/**
 * Re-resolves a saved path-only queue against today's library rows. Duplicate
 * queue entries remain duplicates; deleted paths are removed occurrence-wise.
 */
export function resolvePlaybackSession<T extends SessionTrackLike>(
  snapshot: PlaybackSessionSnapshotV1,
  libraryTracks: readonly T[]
): ResolvedPlaybackSession<T> | null {
  const byPath = new Map(libraryTracks.map((track) => [track.path, track]));
  const resolvedEntries = snapshot.queuePaths.flatMap((path, originalIndex) => {
    const track = byPath.get(path);
    return track ? [{ track, originalIndex }] : [];
  });
  if (resolvedEntries.length === 0) return null;

  let resolvedActiveIndex = resolvedEntries.findIndex(
    (entry) => entry.originalIndex === snapshot.activeIndex
  );
  const activeSurvived = resolvedActiveIndex >= 0;
  if (!activeSurvived) {
    resolvedActiveIndex = resolvedEntries.findIndex(
      (entry) => entry.originalIndex > snapshot.activeIndex
    );
    if (resolvedActiveIndex < 0) resolvedActiveIndex = resolvedEntries.length - 1;
  }

  const activeTrack = resolvedEntries[resolvedActiveIndex].track;
  const duration = Number.isFinite(activeTrack.duration) && activeTrack.duration > 0
    ? activeTrack.duration
    : 0;
  const position = activeSurvived
    ? Math.max(0, duration > 0 ? Math.min(snapshot.position, duration) : 0)
    : 0;

  const survivingPaths = new Set(byPath.keys());
  const originalOrderPaths = snapshot.originalOrderPaths.filter((path) => survivingPaths.has(path));
  const resolvedQueuePaths = resolvedEntries.map((entry) => entry.track.path);

  return {
    tracks: resolvedEntries.map((entry) => entry.track),
    activeIndex: resolvedActiveIndex,
    position,
    shuffle: snapshot.shuffle,
    repeat: snapshot.repeat,
    originalOrderPaths: samePathMultiset(originalOrderPaths, resolvedQueuePaths)
      ? originalOrderPaths
      : resolvedQueuePaths,
  };
}

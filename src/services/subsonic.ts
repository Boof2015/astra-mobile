// Subsonic client — ported from desktop Astra (src/main/services/subsonic.ts).
// Changes vs desktop: Node `crypto` (md5 token + random salt) -> src/lib/hash;
// the ArrayBuffer stream/cover fetchers are dropped (ExoPlayer + expo-image fetch
// the URLs directly), and a sync `buildSubsonicCoverArtUrl` is added.

import { md5Hex, randomSaltHex } from '@/lib/hash';
import type {
  RemoteCatalogTrack,
  RemoteConnectionConfig,
  RemotePlaylist,
  RemotePlaylistTrack,
  RemoteSyncProgress,
} from '@/types/remote';

const SUBSONIC_API_VERSION = '1.16.1';
const SUBSONIC_CLIENT_ID = 'astra';
const DEFAULT_TIMEOUT_MS = 12_000;
const DEFAULT_RETRIES = 1;
const MAX_SYNC_CONCURRENCY = 4;

export interface SubsonicRequestOptions {
  timeoutMs?: number;
  retries?: number;
  signal?: AbortSignal;
}

export interface SubsonicCatalogSyncOptions extends SubsonicRequestOptions {
  onProgress?: (progress: RemoteSyncProgress) => void;
}

export interface SubsonicCatalogSyncResult {
  artistsScanned: number;
  albumsScanned: number;
  tracksScanned: number;
  tracks: RemoteCatalogTrack[];
}

interface SubsonicResponseEnvelope {
  'subsonic-response'?: {
    status?: string;
    error?: { code?: number; message?: string };
    [key: string]: unknown;
  };
}

interface SubsonicArtistRef {
  id: string;
}

interface SubsonicAlbumRef {
  id: string;
}

interface SubsonicPlaylistRef {
  id: string;
  name: string;
}

interface SubsonicAlbumSongs {
  coverArtId: string | null;
  songs: SubsonicSong[];
}

interface SubsonicSong {
  id?: unknown;
  title?: unknown;
  artist?: unknown;
  album?: unknown;
  albumArtist?: unknown;
  coverArt?: unknown;
  duration?: unknown;
  track?: unknown;
  discNumber?: unknown;
  year?: unknown;
  genre?: unknown;
  suffix?: unknown;
  contentType?: unknown;
  bitRate?: unknown;
  sampleRate?: unknown;
  bitDepth?: unknown;
  channelCount?: unknown;
  path?: unknown;
}

function asArray<T>(value: unknown): T[] {
  if (!value) return [];
  return Array.isArray(value) ? (value as T[]) : [value as T];
}

function toTrimmedText(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function toFiniteNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function toFiniteInteger(value: unknown): number | null {
  const parsed = toFiniteNumber(value);
  if (parsed == null) return null;
  const integer = Math.trunc(parsed);
  return Number.isFinite(integer) ? integer : null;
}

function normalizeSubsonicFormat(song: SubsonicSong): string {
  const suffix = toTrimmedText(song.suffix);
  if (suffix) return suffix.toLowerCase();

  const pathValue = toTrimmedText(song.path);
  if (pathValue && pathValue.includes('.')) {
    const ext = pathValue.split('.').pop()?.trim().toLowerCase();
    if (ext) return ext;
  }

  const contentType = toTrimmedText(song.contentType);
  if (contentType?.includes('/')) {
    const subtype = contentType.split('/')[1]?.trim().toLowerCase();
    if (subtype) return subtype;
  }

  return 'unknown';
}

export function normalizeSubsonicBaseUrl(rawBaseUrl: string): string {
  const trimmed = rawBaseUrl.trim();
  if (!trimmed) {
    throw new Error('Server URL is required.');
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(trimmed);
  } catch {
    throw new Error('Server URL is invalid.');
  }

  const protocol = parsedUrl.protocol.toLowerCase();
  if (protocol !== 'http:' && protocol !== 'https:') {
    throw new Error('Server URL must use http:// or https://');
  }

  parsedUrl.hash = '';
  parsedUrl.search = '';
  parsedUrl.pathname = parsedUrl.pathname.replace(/\/+$/, '');
  return parsedUrl.toString().replace(/\/+$/, '');
}

function buildAuthQuery(
  config: RemoteConnectionConfig,
  options: { includeFormat?: boolean } = {}
): Record<string, string> {
  const username = config.username.trim();
  const password = config.password;
  if (!username) {
    throw new Error('Username is required.');
  }
  if (!password) {
    throw new Error('Password is required.');
  }

  const salt = randomSaltHex(6);
  const token = md5Hex(`${password}${salt}`);

  const query: Record<string, string> = {
    u: username,
    t: token,
    s: salt,
    v: SUBSONIC_API_VERSION,
    c: SUBSONIC_CLIENT_ID,
  };
  if (options.includeFormat !== false) {
    query.f = 'json';
  }
  return query;
}

function buildSubsonicEndpointUrl(
  config: RemoteConnectionConfig,
  endpoint: string,
  params: Record<string, string | number | boolean | null | undefined>,
  options: { includeFormat?: boolean } = {}
): URL {
  const baseUrl = normalizeSubsonicBaseUrl(config.baseUrl);
  const url = new URL(`${baseUrl}/rest/${endpoint}.view`);
  const auth = buildAuthQuery(config, options);
  for (const [key, value] of Object.entries(auth)) {
    url.searchParams.set(key, value);
  }
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue;
    url.searchParams.set(key, String(value));
  }
  return url;
}

function mergeAbortSignals(
  signal: AbortSignal | undefined,
  timeoutMs: number
): { signal: AbortSignal; cleanup: () => void } {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  const onAbort = () => controller.abort();
  if (signal) {
    if (signal.aborted) {
      controller.abort();
    } else {
      signal.addEventListener('abort', onAbort, { once: true });
    }
  }

  return {
    signal: controller.signal,
    cleanup: () => {
      clearTimeout(timeoutId);
      if (signal) signal.removeEventListener('abort', onAbort);
    },
  };
}

async function requestSubsonicJson(
  config: RemoteConnectionConfig,
  endpoint: string,
  params: Record<string, string | number | boolean | null | undefined>,
  options: SubsonicRequestOptions = {}
): Promise<Record<string, unknown>> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const retries = Math.max(0, options.retries ?? DEFAULT_RETRIES);
  const url = buildSubsonicEndpointUrl(config, endpoint, params, { includeFormat: true });

  let lastError: unknown = null;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const merged = mergeAbortSignals(options.signal, timeoutMs);
    try {
      const response = await fetch(url, { method: 'GET', signal: merged.signal });
      if (!response.ok) {
        throw new Error(`Subsonic request failed (${response.status})`);
      }

      const json = (await response.json()) as SubsonicResponseEnvelope;
      const envelope = json['subsonic-response'];
      if (!envelope || typeof envelope !== 'object') {
        throw new Error('Invalid Subsonic response payload.');
      }
      if (envelope.status !== 'ok') {
        const message = toTrimmedText(envelope.error?.message) ?? 'Subsonic request failed.';
        throw new Error(message);
      }

      return envelope as Record<string, unknown>;
    } catch (error) {
      lastError = error;
      if (attempt >= retries) throw error;
    } finally {
      merged.cleanup();
    }
  }

  throw lastError instanceof Error ? lastError : new Error('Subsonic request failed.');
}

async function runWithConcurrency<T, R>(
  values: T[],
  concurrency: number,
  worker: (value: T, index: number) => Promise<R>
): Promise<R[]> {
  if (values.length === 0) return [];

  const maxWorkers = Math.max(1, Math.min(concurrency, values.length));
  const results: R[] = new Array(values.length);
  let nextIndex = 0;

  const runWorker = async (): Promise<void> => {
    while (nextIndex < values.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      results[currentIndex] = await worker(values[currentIndex], currentIndex);
    }
  };

  await Promise.all(Array.from({ length: maxWorkers }, () => runWorker()));
  return results;
}

export async function testSubsonicConnection(
  config: RemoteConnectionConfig,
  options: SubsonicRequestOptions = {}
): Promise<void> {
  await requestSubsonicJson(config, 'ping', {}, options);
}

function toArtistRefs(indexResponse: Record<string, unknown>): SubsonicArtistRef[] {
  const artistsContainer = indexResponse.artists as Record<string, unknown> | undefined;
  if (!artistsContainer || typeof artistsContainer !== 'object') return [];

  const indexEntries = asArray<Record<string, unknown>>(artistsContainer.index);
  const artistIds: SubsonicArtistRef[] = [];
  for (const indexEntry of indexEntries) {
    for (const artist of asArray<Record<string, unknown>>(indexEntry.artist)) {
      const id = toTrimmedText(artist.id);
      if (!id) continue;
      artistIds.push({ id });
    }
  }

  return artistIds;
}

function toAlbumRefs(artistResponse: Record<string, unknown>): SubsonicAlbumRef[] {
  const artistContainer = artistResponse.artist as Record<string, unknown> | undefined;
  if (!artistContainer || typeof artistContainer !== 'object') return [];

  const albums = asArray<Record<string, unknown>>(artistContainer.album);
  return albums
    .map((album) => toTrimmedText(album.id))
    .filter((id): id is string => Boolean(id))
    .map((id) => ({ id }));
}

function mapSongToCatalogTrack(
  sourceId: number,
  song: SubsonicSong,
  fallbackCoverArtId: string | null
): RemoteCatalogTrack | null {
  const sourceTrackId = toTrimmedText(song.id);
  if (!sourceTrackId) return null;

  const title = toTrimmedText(song.title) ?? `Track ${sourceTrackId}`;
  const artist = toTrimmedText(song.artist) ?? 'Unknown Artist';
  const album = toTrimmedText(song.album) ?? 'Unknown Album';
  const albumArtist = toTrimmedText(song.albumArtist);
  const duration = toFiniteNumber(song.duration);
  const bitrate = toFiniteInteger(song.bitRate);
  const sampleRate = toFiniteInteger(song.sampleRate);
  const bitDepth = toFiniteInteger(song.bitDepth);
  const channels = toFiniteInteger(song.channelCount);
  const trackNumber = toFiniteInteger(song.track);
  const discNumber = toFiniteInteger(song.discNumber);
  const year = toFiniteInteger(song.year);
  const genre = toTrimmedText(song.genre);
  const sourcePath = toTrimmedText(song.path);
  const contentType = toTrimmedText(song.contentType);
  const artworkSourceId = toTrimmedText(song.coverArt) ?? fallbackCoverArtId;

  return {
    path: buildSubsonicTrackPath(sourceId, sourceTrackId),
    source_track_id: sourceTrackId,
    source_path: sourcePath,
    artwork_source_id: artworkSourceId,
    title,
    artist,
    album,
    album_artist: albumArtist,
    duration: duration && duration > 0 ? duration : 0,
    track_number: trackNumber,
    disc_number: discNumber,
    year,
    genre,
    artwork_hash: null,
    format: normalizeSubsonicFormat(song),
    sample_rate: sampleRate,
    bit_depth: bitDepth,
    bitrate,
    channels,
    codec: contentType,
    codec_profile: null,
    is_atmos_joc: null,
    replaygain_track_gain_db: null,
    replaygain_album_gain_db: null,
    bpm: null,
    musical_key: null,
  };
}

export async function syncSubsonicCatalog(
  sourceId: number,
  config: RemoteConnectionConfig,
  options: SubsonicCatalogSyncOptions = {}
): Promise<SubsonicCatalogSyncResult> {
  const indexResponse = await requestSubsonicJson(config, 'getArtists', {}, options);
  const artistRefs = toArtistRefs(indexResponse);
  options.onProgress?.({ phase: 'artists', current: 0, total: artistRefs.length, detail: null });
  if (artistRefs.length === 0) {
    return { artistsScanned: 0, albumsScanned: 0, tracksScanned: 0, tracks: [] };
  }

  let artistsProcessed = 0;
  const albumRefsByArtist = await runWithConcurrency(
    artistRefs,
    MAX_SYNC_CONCURRENCY,
    async (artistRef) => {
      const artistResponse = await requestSubsonicJson(
        config,
        'getArtist',
        { id: artistRef.id },
        options
      );
      const albums = toAlbumRefs(artistResponse);
      artistsProcessed += 1;
      options.onProgress?.({
        phase: 'artists',
        current: artistsProcessed,
        total: artistRefs.length,
        detail: artistRef.id,
      });
      return albums;
    }
  );

  const allAlbumRefs = albumRefsByArtist.flat();
  const uniqueAlbumIds = Array.from(new Set(allAlbumRefs.map((album) => album.id)));
  options.onProgress?.({ phase: 'albums', current: 0, total: uniqueAlbumIds.length, detail: null });

  let albumsProcessed = 0;
  const albumSongLists = await runWithConcurrency(
    uniqueAlbumIds,
    MAX_SYNC_CONCURRENCY,
    async (albumId): Promise<SubsonicAlbumSongs> => {
      const albumResponse = await requestSubsonicJson(config, 'getAlbum', { id: albumId }, options);
      const albumContainer = albumResponse.album as Record<string, unknown> | undefined;
      if (!albumContainer || typeof albumContainer !== 'object') {
        albumsProcessed += 1;
        options.onProgress?.({
          phase: 'albums',
          current: albumsProcessed,
          total: uniqueAlbumIds.length,
          detail: albumId,
        });
        return { coverArtId: null, songs: [] };
      }
      albumsProcessed += 1;
      options.onProgress?.({
        phase: 'albums',
        current: albumsProcessed,
        total: uniqueAlbumIds.length,
        detail: albumId,
      });
      return {
        coverArtId: toTrimmedText(albumContainer.coverArt),
        songs: asArray<SubsonicSong>(albumContainer.song),
      };
    }
  );

  const byTrackId = new Map<string, RemoteCatalogTrack>();
  options.onProgress?.({ phase: 'tracks', current: 0, total: albumSongLists.length, detail: null });
  let trackAlbumProcessed = 0;
  for (const albumSongs of albumSongLists) {
    for (const song of albumSongs.songs) {
      const mapped = mapSongToCatalogTrack(sourceId, song, albumSongs.coverArtId);
      if (!mapped) continue;
      byTrackId.set(mapped.source_track_id, mapped);
    }
    trackAlbumProcessed += 1;
    options.onProgress?.({
      phase: 'tracks',
      current: trackAlbumProcessed,
      total: albumSongLists.length,
      detail: null,
    });
  }

  const tracks = Array.from(byTrackId.values());
  return {
    artistsScanned: artistRefs.length,
    albumsScanned: uniqueAlbumIds.length,
    tracksScanned: tracks.length,
    tracks,
  };
}

export function buildSubsonicTrackPath(sourceId: number, sourceTrackId: string): string {
  return `subsonic://${sourceId}/track/${encodeURIComponent(sourceTrackId)}`;
}

export function parseSubsonicTrackPath(
  path: string
): { sourceId: number; sourceTrackId: string } | null {
  const match = /^subsonic:\/\/(\d+)\/track\/(.+)$/.exec(path);
  if (!match) return null;

  const sourceId = Number.parseInt(match[1], 10);
  if (!Number.isInteger(sourceId) || sourceId <= 0) return null;

  const sourceTrackIdRaw = match[2];
  if (!sourceTrackIdRaw) return null;
  try {
    const sourceTrackId = decodeURIComponent(sourceTrackIdRaw);
    if (!sourceTrackId) return null;
    return { sourceId, sourceTrackId };
  } catch {
    return null;
  }
}

export function buildSubsonicStreamUrl(
  config: RemoteConnectionConfig,
  sourceTrackId: string,
  options: { maxBitRateKbps?: number } = {}
): string {
  const maxBitRateKbps = options.maxBitRateKbps;
  return buildSubsonicEndpointUrl(
    config,
    'stream',
    {
      id: sourceTrackId,
      maxBitRate:
        typeof maxBitRateKbps === 'number' && Number.isFinite(maxBitRateKbps) && maxBitRateKbps > 0
          ? Math.trunc(maxBitRateKbps)
          : undefined,
    },
    { includeFormat: false }
  ).toString();
}

export function buildSubsonicCoverArtUrl(
  config: RemoteConnectionConfig,
  coverArtId: string,
  options: { size?: number } = {}
): string {
  return buildSubsonicEndpointUrl(
    config,
    'getCoverArt',
    { id: coverArtId, size: options.size },
    { includeFormat: false }
  ).toString();
}

// --- Favorites (starred) + playlists -----------------------------------------

function toStarredTrackIds(starredResponse: Record<string, unknown>): string[] {
  const starredContainer = starredResponse.starred as Record<string, unknown> | undefined;
  if (!starredContainer || typeof starredContainer !== 'object') return [];

  const ids = new Set<string>();
  for (const song of asArray<SubsonicSong>(starredContainer.song)) {
    const id = toTrimmedText(song.id);
    if (id) ids.add(id);
  }
  return Array.from(ids);
}

function toPlaylistRefs(playlistsResponse: Record<string, unknown>): SubsonicPlaylistRef[] {
  const playlistsContainer = playlistsResponse.playlists as Record<string, unknown> | undefined;
  if (!playlistsContainer || typeof playlistsContainer !== 'object') return [];

  return asArray<Record<string, unknown>>(playlistsContainer.playlist)
    .map((playlist) => {
      const id = toTrimmedText(playlist.id);
      if (!id) return null;
      return { id, name: toTrimmedText(playlist.name) ?? `Playlist ${id}` };
    })
    .filter((playlist): playlist is SubsonicPlaylistRef => playlist !== null);
}

function toPlaylistTracks(
  sourceId: number,
  playlistResponse: Record<string, unknown>
): RemotePlaylistTrack[] {
  const playlistContainer = playlistResponse.playlist as Record<string, unknown> | undefined;
  if (!playlistContainer || typeof playlistContainer !== 'object') return [];

  const entries = asArray<SubsonicSong>(playlistContainer.entry ?? playlistContainer.song);
  const tracks: RemotePlaylistTrack[] = [];
  const seen = new Set<string>();
  for (const entry of entries) {
    const sourceTrackId = toTrimmedText(entry.id);
    if (!sourceTrackId || seen.has(sourceTrackId)) continue;
    seen.add(sourceTrackId);
    tracks.push({
      path: buildSubsonicTrackPath(sourceId, sourceTrackId),
      source_track_id: sourceTrackId,
      title: toTrimmedText(entry.title),
      artist: toTrimmedText(entry.artist),
      album: toTrimmedText(entry.album),
    });
  }
  return tracks;
}

/** Server-side starred (favorite) track ids. */
export async function fetchSubsonicStarredTrackIds(
  config: RemoteConnectionConfig,
  options: SubsonicRequestOptions = {}
): Promise<string[]> {
  const starredResponse = await requestSubsonicJson(config, 'getStarred', {}, options);
  return toStarredTrackIds(starredResponse);
}

/** Server playlists with their track lists (getPlaylists -> getPlaylist per playlist). */
export async function syncSubsonicPlaylists(
  sourceId: number,
  config: RemoteConnectionConfig,
  options: SubsonicCatalogSyncOptions = {}
): Promise<RemotePlaylist[]> {
  const playlistsResponse = await requestSubsonicJson(config, 'getPlaylists', {}, options);
  const playlistRefs = toPlaylistRefs(playlistsResponse);
  options.onProgress?.({ phase: 'playlists', current: 0, total: playlistRefs.length, detail: null });

  let processed = 0;
  return runWithConcurrency(
    playlistRefs,
    MAX_SYNC_CONCURRENCY,
    async (playlistRef): Promise<RemotePlaylist> => {
      const playlistResponse = await requestSubsonicJson(
        config,
        'getPlaylist',
        { id: playlistRef.id },
        options
      );
      processed += 1;
      options.onProgress?.({
        phase: 'playlists',
        current: processed,
        total: playlistRefs.length,
        detail: playlistRef.id,
      });
      return {
        source_playlist_id: playlistRef.id,
        name: playlistRef.name,
        tracks: toPlaylistTracks(sourceId, playlistResponse),
      };
    }
  );
}

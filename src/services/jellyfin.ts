// Jellyfin client — ported from desktop Astra (src/main/services/jellyfin.ts).
// Changes vs desktop: Node `crypto` (sha1 device id) -> src/lib/hash; the
// ArrayBuffer stream/cover fetchers are dropped (ExoPlayer + expo-image fetch the
// URLs directly). Stream/transcode/cover URLs already embed `api_key`, so they are
// self-contained — no per-track auth headers needed at playback time.

import { sha1Hex } from '@/lib/hash';
import type {
  RemoteCatalogTrack,
  RemoteConnectionConfig,
  RemoteSyncProgress,
} from '@/types/remote';

const DEFAULT_TIMEOUT_MS = 12_000;
const DEFAULT_RETRIES = 1;
const DEFAULT_PAGE_SIZE = 500;
const CLIENT_NAME = 'Astra';
const CLIENT_VERSION = '0.4.0';
const DEVICE_NAME = 'Astra Mobile';
const TRANSCODE_AUDIO_CODEC = 'mp3';
const TRANSCODE_CONTAINER = 'mp3';

export interface JellyfinAuthContext {
  accessToken: string;
  userId: string;
}

export interface JellyfinRequestOptions {
  timeoutMs?: number;
  retries?: number;
  signal?: AbortSignal;
}

export interface JellyfinCatalogSyncOptions extends JellyfinRequestOptions {
  authContext?: JellyfinAuthContext;
  onProgress?: (progress: RemoteSyncProgress) => void;
  /** Awaited once per server page so callers can stream directly to native storage. */
  onTracksBatch?: (tracks: RemoteCatalogTrack[]) => Promise<void>;
  /** Defaults to true for compatibility; sync orchestration disables collection. */
  collectTracks?: boolean;
}

export interface JellyfinCatalogSyncResult {
  itemsScanned: number;
  tracksScanned: number;
  tracks: RemoteCatalogTrack[];
}

interface JellyfinAuthenticateResponse {
  AccessToken?: unknown;
  User?: { Id?: unknown };
}

interface JellyfinItemsResponse {
  Items?: unknown;
  TotalRecordCount?: unknown;
}

interface JellyfinAudioStream {
  Type?: unknown;
  Codec?: unknown;
  Profile?: unknown;
  Channels?: unknown;
  BitRate?: unknown;
  SampleRate?: unknown;
  BitDepth?: unknown;
}

interface JellyfinAudioItem {
  Id?: unknown;
  Name?: unknown;
  Path?: unknown;
  Artists?: unknown;
  ArtistItems?: unknown;
  Album?: unknown;
  AlbumArtist?: unknown;
  AlbumArtists?: unknown;
  AlbumId?: unknown;
  AlbumPrimaryImageTag?: unknown;
  ImageTags?: unknown;
  RunTimeTicks?: unknown;
  IndexNumber?: unknown;
  ParentIndexNumber?: unknown;
  ProductionYear?: unknown;
  Genres?: unknown;
  Container?: unknown;
  Bitrate?: unknown;
  MediaStreams?: unknown;
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
  const intValue = Math.trunc(parsed);
  return Number.isFinite(intValue) ? intValue : null;
}

function normalizeBooleanQueryValue(value: boolean): string {
  return value ? 'true' : 'false';
}

export function normalizeJellyfinBaseUrl(rawBaseUrl: string): string {
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

export function buildJellyfinDeviceId(config: RemoteConnectionConfig): string {
  const base = normalizeJellyfinBaseUrl(config.baseUrl);
  const username = config.username.trim().toLowerCase();
  return sha1Hex(`${base}|${username}|${CLIENT_NAME}`);
}

function escapeHeaderTokenValue(value: string): string {
  return value.replace(/"/g, '\\"');
}

function buildJellyfinAuthorizationHeader(
  config: RemoteConnectionConfig,
  options: { token?: string } = {}
): string {
  const parts = [
    `Client="${escapeHeaderTokenValue(CLIENT_NAME)}"`,
    `Device="${escapeHeaderTokenValue(DEVICE_NAME)}"`,
    `DeviceId="${escapeHeaderTokenValue(buildJellyfinDeviceId(config))}"`,
    `Version="${escapeHeaderTokenValue(CLIENT_VERSION)}"`,
  ];
  if (options.token) {
    parts.push(`Token="${escapeHeaderTokenValue(options.token)}"`);
  }
  return `MediaBrowser ${parts.join(', ')}`;
}

function buildJellyfinUrl(
  config: RemoteConnectionConfig,
  endpoint: string,
  params: Record<string, string | number | boolean | null | undefined>
): URL {
  const baseUrl = normalizeJellyfinBaseUrl(config.baseUrl);
  const normalizedEndpoint = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
  const url = new URL(`${baseUrl}${normalizedEndpoint}`);
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue;
    if (typeof value === 'boolean') {
      url.searchParams.set(key, normalizeBooleanQueryValue(value));
    } else {
      url.searchParams.set(key, String(value));
    }
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

async function requestJellyfinJson(
  config: RemoteConnectionConfig,
  authContext: JellyfinAuthContext,
  endpoint: string,
  params: Record<string, string | number | boolean | null | undefined>,
  options: JellyfinRequestOptions = {}
): Promise<Record<string, unknown>> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const retries = Math.max(0, options.retries ?? DEFAULT_RETRIES);
  const url = buildJellyfinUrl(config, endpoint, params);

  let lastError: unknown = null;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const merged = mergeAbortSignals(options.signal, timeoutMs);
    try {
      const response = await fetch(url, {
        method: 'GET',
        signal: merged.signal,
        headers: {
          Accept: 'application/json',
          'X-Emby-Authorization': buildJellyfinAuthorizationHeader(config, {
            token: authContext.accessToken,
          }),
          'X-Emby-Token': authContext.accessToken,
        },
      });

      if (!response.ok) {
        throw new Error(`Jellyfin request failed (${response.status})`);
      }

      return (await response.json()) as Record<string, unknown>;
    } catch (error) {
      lastError = error;
      if (attempt >= retries) throw error;
    } finally {
      merged.cleanup();
    }
  }

  throw lastError instanceof Error ? lastError : new Error('Jellyfin request failed.');
}

export async function authenticateJellyfin(
  config: RemoteConnectionConfig,
  options: JellyfinRequestOptions = {}
): Promise<JellyfinAuthContext> {
  const baseUrl = normalizeJellyfinBaseUrl(config.baseUrl);
  const username = config.username.trim();
  const password = config.password;

  if (!username) {
    throw new Error('Username is required.');
  }
  if (!password) {
    throw new Error('Password is required.');
  }

  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const retries = Math.max(0, options.retries ?? DEFAULT_RETRIES);
  const url = new URL(`${baseUrl}/Users/AuthenticateByName`);

  let lastError: unknown = null;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const merged = mergeAbortSignals(options.signal, timeoutMs);
    try {
      const response = await fetch(url, {
        method: 'POST',
        signal: merged.signal,
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          'X-Emby-Authorization': buildJellyfinAuthorizationHeader(config),
        },
        body: JSON.stringify({ Username: username, Pw: password }),
      });

      if (!response.ok) {
        throw new Error(`Jellyfin authentication failed (${response.status})`);
      }

      const payload = (await response.json()) as JellyfinAuthenticateResponse;
      const accessToken = toTrimmedText(payload.AccessToken);
      const userId = toTrimmedText(payload.User?.Id);

      if (!accessToken || !userId) {
        throw new Error('Invalid Jellyfin authentication response.');
      }

      return { accessToken, userId };
    } catch (error) {
      lastError = error;
      if (attempt >= retries) throw error;
    } finally {
      merged.cleanup();
    }
  }

  throw lastError instanceof Error ? lastError : new Error('Jellyfin authentication failed.');
}

export async function testJellyfinConnection(
  config: RemoteConnectionConfig,
  options: JellyfinRequestOptions = {}
): Promise<void> {
  await authenticateJellyfin(config, options);
}

function resolveJellyfinArtist(item: JellyfinAudioItem): string {
  const artists = asArray<string>(item.Artists)
    .map((value) => toTrimmedText(value))
    .filter((value): value is string => Boolean(value));
  if (artists.length > 0) return artists[0];

  const artistItems = asArray<Record<string, unknown>>(item.ArtistItems);
  for (const artistItem of artistItems) {
    const candidate = toTrimmedText(artistItem.Name);
    if (candidate) return candidate;
  }

  return 'Unknown Artist';
}

function resolveJellyfinAlbumArtist(item: JellyfinAudioItem): string | null {
  const direct = toTrimmedText(item.AlbumArtist);
  if (direct) return direct;

  const albumArtists = asArray<string>(item.AlbumArtists)
    .map((value) => toTrimmedText(value))
    .filter((value): value is string => Boolean(value));

  if (albumArtists.length > 0) return albumArtists[0];
  return null;
}

function resolveJellyfinArtworkSourceId(
  item: JellyfinAudioItem,
  sourceTrackId: string
): string | null {
  const albumId = toTrimmedText(item.AlbumId);
  const albumPrimaryImageTag = toTrimmedText(item.AlbumPrimaryImageTag);
  if (albumId && albumPrimaryImageTag) {
    return albumId;
  }

  const imageTags = item.ImageTags;
  if (imageTags && typeof imageTags === 'object') {
    const primary = toTrimmedText((imageTags as Record<string, unknown>).Primary);
    if (primary) {
      return sourceTrackId;
    }
  }

  return null;
}

function normalizeJellyfinFormat(item: JellyfinAudioItem): string {
  const container = toTrimmedText(item.Container);
  if (container) return container.toLowerCase();

  const pathValue = toTrimmedText(item.Path);
  if (pathValue && pathValue.includes('.')) {
    const ext = pathValue.split('.').pop()?.trim().toLowerCase();
    if (ext) return ext;
  }

  return 'unknown';
}

function isAtmosJoc(codec: string | null, profile: string | null): boolean {
  const combined = `${codec ?? ''} ${profile ?? ''}`.toLowerCase();
  return combined.includes('atmos') || combined.includes('joc');
}

function mapJellyfinItemToCatalogTrack(
  sourceId: number,
  item: JellyfinAudioItem
): RemoteCatalogTrack | null {
  const sourceTrackId = toTrimmedText(item.Id);
  if (!sourceTrackId) return null;

  const title = toTrimmedText(item.Name) ?? `Track ${sourceTrackId}`;
  const artist = resolveJellyfinArtist(item);
  const album = toTrimmedText(item.Album) ?? 'Unknown Album';
  const albumArtist = resolveJellyfinAlbumArtist(item);
  const durationTicks = toFiniteNumber(item.RunTimeTicks);
  const duration = durationTicks && durationTicks > 0 ? durationTicks / 10_000_000 : 0;
  const trackNumber = toFiniteInteger(item.IndexNumber);
  const discNumber = toFiniteInteger(item.ParentIndexNumber);
  const year = toFiniteInteger(item.ProductionYear);
  const genre =
    asArray<string>(item.Genres)
      .map((value) => toTrimmedText(value))
      .find((value): value is string => Boolean(value)) ?? null;

  const sourcePath = toTrimmedText(item.Path);
  const mediaStreams = asArray<JellyfinAudioStream>(item.MediaStreams);
  const audioStream = mediaStreams.find(
    (stream) => toTrimmedText(stream.Type)?.toLowerCase() === 'audio'
  );
  const codec = toTrimmedText(audioStream?.Codec);
  const codecProfile = toTrimmedText(audioStream?.Profile);
  const channels = toFiniteInteger(audioStream?.Channels);
  const sampleRate = toFiniteInteger(audioStream?.SampleRate);
  const bitDepth = toFiniteInteger(audioStream?.BitDepth);
  const streamBitrate = toFiniteInteger(audioStream?.BitRate);
  const itemBitrate = toFiniteInteger(item.Bitrate);
  const artworkSourceId = resolveJellyfinArtworkSourceId(item, sourceTrackId);

  return {
    path: buildJellyfinTrackPath(sourceId, sourceTrackId),
    source_track_id: sourceTrackId,
    source_path: sourcePath,
    artwork_source_id: artworkSourceId,
    title,
    artist,
    album,
    album_artist: albumArtist,
    duration,
    track_number: trackNumber,
    disc_number: discNumber,
    year,
    genre,
    artwork_hash: null,
    format: normalizeJellyfinFormat(item),
    sample_rate: sampleRate,
    bit_depth: bitDepth,
    bitrate: streamBitrate ?? itemBitrate,
    channels,
    codec,
    codec_profile: codecProfile,
    is_atmos_joc: isAtmosJoc(codec, codecProfile) ? 1 : null,
    replaygain_track_gain_db: null,
    replaygain_album_gain_db: null,
    bpm: null,
    musical_key: null,
  };
}

export async function syncJellyfinCatalog(
  sourceId: number,
  config: RemoteConnectionConfig,
  options: JellyfinCatalogSyncOptions = {}
): Promise<JellyfinCatalogSyncResult> {
  const authContext = options.authContext ?? (await authenticateJellyfin(config, options));
  const byTrackId = options.collectTracks === false
    ? null
    : new Map<string, RemoteCatalogTrack>();
  const seenTrackIds = new Set<string>();
  let tracksScanned = 0;
  let startIndex = 0;
  let totalRecordCount: number | null = null;

  while (true) {
    const response = (await requestJellyfinJson(
      config,
      authContext,
      `/Users/${encodeURIComponent(authContext.userId)}/Items`,
      {
        Recursive: true,
        IncludeItemTypes: 'Audio',
        Fields:
          'Path,Genres,Container,Bitrate,RunTimeTicks,ProductionYear,IndexNumber,ParentIndexNumber,Album,AlbumArtist,AlbumArtists,AlbumId,AlbumPrimaryImageTag,ImageTags,MediaStreams',
        SortBy: 'SortName',
        SortOrder: 'Ascending',
        StartIndex: startIndex,
        Limit: DEFAULT_PAGE_SIZE,
      },
      options
    )) as JellyfinItemsResponse;

    const total = toFiniteInteger(response.TotalRecordCount);
    if (totalRecordCount === null && total !== null && total >= 0) {
      totalRecordCount = total;
    }

    const items = asArray<JellyfinAudioItem>(response.Items);
    const trackBatch: RemoteCatalogTrack[] = [];
    for (const item of items) {
      const mapped = mapJellyfinItemToCatalogTrack(sourceId, item);
      if (!mapped || !seenTrackIds.add(mapped.source_track_id)) continue;
      byTrackId?.set(mapped.source_track_id, mapped);
      trackBatch.push(mapped);
      tracksScanned += 1;
    }
    if (trackBatch.length > 0) await options.onTracksBatch?.(trackBatch);

    options.onProgress?.({
      phase: 'items',
      current: startIndex + items.length,
      total: totalRecordCount ?? startIndex + items.length,
      detail: null,
    });

    if (items.length === 0) break;
    startIndex += items.length;
    if (totalRecordCount !== null && startIndex >= totalRecordCount) break;
    if (items.length < DEFAULT_PAGE_SIZE) break;
  }

  const tracks = byTrackId ? Array.from(byTrackId.values()) : [];
  return {
    itemsScanned: totalRecordCount ?? tracksScanned,
    tracksScanned,
    tracks,
  };
}

export function buildJellyfinTrackPath(sourceId: number, sourceTrackId: string): string {
  return `jellyfin://${sourceId}/track/${encodeURIComponent(sourceTrackId)}`;
}

export function parseJellyfinTrackPath(
  path: string
): { sourceId: number; sourceTrackId: string } | null {
  const match = /^jellyfin:\/\/(\d+)\/track\/(.+)$/.exec(path);
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

export function buildJellyfinStreamUrl(
  config: RemoteConnectionConfig,
  sourceTrackId: string,
  accessToken: string
): string {
  return buildJellyfinUrl(config, `/Items/${encodeURIComponent(sourceTrackId)}/Download`, {
    api_key: accessToken,
  }).toString();
}

export function buildJellyfinTranscodeStreamUrl(
  config: RemoteConnectionConfig,
  sourceTrackId: string,
  authContext: JellyfinAuthContext,
  maxBitRateKbps: number
): string {
  const normalizedMaxBitrate = Math.max(16, Math.trunc(maxBitRateKbps)) * 1000;
  return buildJellyfinUrl(config, `/Audio/${encodeURIComponent(sourceTrackId)}/universal`, {
    UserId: authContext.userId,
    DeviceId: buildJellyfinDeviceId(config),
    api_key: authContext.accessToken,
    AudioCodec: TRANSCODE_AUDIO_CODEC,
    Container: TRANSCODE_CONTAINER,
    TranscodingContainer: TRANSCODE_CONTAINER,
    MaxStreamingBitrate: normalizedMaxBitrate,
  }).toString();
}

export function buildJellyfinCoverArtUrl(
  config: RemoteConnectionConfig,
  itemId: string,
  accessToken: string,
  options: { quality?: number; maxWidth?: number } = {}
): string {
  return buildJellyfinUrl(config, `/Items/${encodeURIComponent(itemId)}/Images/Primary`, {
    api_key: accessToken,
    quality: options.quality ?? 90,
    maxWidth: options.maxWidth,
  }).toString();
}

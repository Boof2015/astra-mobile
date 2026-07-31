import type {
  DeezerArtistCandidate,
  DeezerSearchResult,
} from '@/types/artistImages';

const DEEZER_ARTIST_SEARCH_URL = 'https://api.deezer.com/search/artist';
const DEFAULT_RETRY_MS = 30 * 60 * 1000;
const RATE_LIMIT_RETRY_MS = 6 * 60 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 8_000;

export const DEEZER_ARTIST_IMAGES_ENABLED =
  process.env.EXPO_PUBLIC_DEEZER_ARTIST_IMAGES_ENABLED !== 'false';

export function normalizeArtistImageMatchName(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .toLocaleLowerCase('en-US')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function finiteCount(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? Math.floor(value)
    : 0;
}

function safeHttpsUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'https:' ? parsed.toString() : null;
  } catch {
    return null;
  }
}

// Deezer serves a grey silhouette when an artist has no photo: the hash path
// segment is empty, all zeroes, or the md5 of zero bytes. Do NOT match on the
// trailing "-000000-80-0-0" transform suffix — every real CDN URL carries it.
const DEEZER_PLACEHOLDER_IMAGE =
  /\/artist\/(?:\/|0+\/|d41d8cd98f00b204e9800998ecf8427e\/)/i;

function isPlaceholderImage(url: string): boolean {
  return DEEZER_PLACEHOLDER_IMAGE.test(url);
}

export function parseDeezerArtistPayload(payload: unknown): DeezerArtistCandidate[] | null {
  if (typeof payload !== 'object' || payload === null) return null;
  const data = (payload as { data?: unknown }).data;
  if (!Array.isArray(data)) return null;

  const candidates: DeezerArtistCandidate[] = [];
  for (const raw of data) {
    if (typeof raw !== 'object' || raw === null) continue;
    const item = raw as Record<string, unknown>;
    const id =
      typeof item.id === 'number' || typeof item.id === 'string'
        ? String(item.id).trim()
        : '';
    const name = typeof item.name === 'string' ? item.name.trim() : '';
    const imageUrl =
      safeHttpsUrl(item.picture_xl) ??
      safeHttpsUrl(item.picture_big) ??
      safeHttpsUrl(item.picture_medium);
    if (!id || !name || !imageUrl || isPlaceholderImage(imageUrl)) continue;

    candidates.push({
      provider: 'deezer',
      id,
      name,
      imageUrl,
      linkUrl: safeHttpsUrl(item.link),
      fanCount: finiteCount(item.nb_fan),
      albumCount: finiteCount(item.nb_album),
    });
  }
  return candidates;
}

export function pickAutomaticDeezerCandidate(
  artistName: string,
  candidates: DeezerArtistCandidate[]
): DeezerArtistCandidate | null {
  const target = normalizeArtistImageMatchName(artistName);
  if (!target) return null;
  return (
    candidates
      .filter((candidate) => normalizeArtistImageMatchName(candidate.name) === target)
      .sort((left, right) => {
        if (right.fanCount !== left.fanCount) return right.fanCount - left.fanCount;
        const leftNumeric = Number(left.id);
        const rightNumeric = Number(right.id);
        if (Number.isFinite(leftNumeric) && Number.isFinite(rightNumeric)) {
          return leftNumeric - rightNumeric;
        }
        return left.id.localeCompare(right.id);
      })[0] ?? null
  );
}

export async function searchDeezerArtists(
  query: string,
  externalSignal?: AbortSignal
): Promise<DeezerSearchResult> {
  if (!DEEZER_ARTIST_IMAGES_ENABLED) {
    return {
      status: 'transient_error',
      code: 'provider',
      message: 'Deezer artist images are disabled in this build.',
      retryAfterMs: RATE_LIMIT_RETRY_MS,
    };
  }
  const normalizedQuery = query.trim();
  if (!normalizedQuery) return { status: 'success', candidates: [] };

  const controller = new AbortController();
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, REQUEST_TIMEOUT_MS);
  const cancel = () => controller.abort();
  externalSignal?.addEventListener('abort', cancel, { once: true });
  if (externalSignal?.aborted) controller.abort();
  try {
    const response = await fetch(
      `${DEEZER_ARTIST_SEARCH_URL}?q=${encodeURIComponent(normalizedQuery)}&limit=20`,
      {
        headers: { Accept: 'application/json' },
        signal: controller.signal,
      }
    );
    if (response.status === 429) {
      return {
        status: 'transient_error',
        code: 'rate_limited',
        message: 'Deezer is temporarily rate limiting searches. Try again later.',
        retryAfterMs: RATE_LIMIT_RETRY_MS,
      };
    }
    if (!response.ok) {
      return {
        status: 'transient_error',
        code: 'provider',
        message: 'Deezer is temporarily unavailable.',
        retryAfterMs: DEFAULT_RETRY_MS,
      };
    }

    const candidates = parseDeezerArtistPayload(await response.json());
    if (candidates === null) {
      return {
        status: 'transient_error',
        code: 'invalid_response',
        message: 'Deezer returned an unexpected response.',
        retryAfterMs: DEFAULT_RETRY_MS,
      };
    }
    return { status: 'success', candidates };
  } catch (error) {
    const cancelled =
      error instanceof Error &&
      error.name === 'AbortError' &&
      externalSignal?.aborted === true &&
      !timedOut;
    return {
      status: 'transient_error',
      code: cancelled ? 'cancelled' : timedOut ? 'timeout' : 'offline',
      message: cancelled
        ? 'The Deezer search was paused.'
        : timedOut
          ? 'The Deezer search timed out. Try again.'
          : 'Connect to the internet and try the Deezer search again.',
      retryAfterMs: cancelled ? 0 : DEFAULT_RETRY_MS,
    };
  } finally {
    clearTimeout(timeout);
    externalSignal?.removeEventListener('abort', cancel);
  }
}

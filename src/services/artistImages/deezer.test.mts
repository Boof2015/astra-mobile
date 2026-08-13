import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeArtistImageMatchName,
  parseDeezerArtistPayload,
  pickAutomaticDeezerCandidate,
  searchDeezerArtists,
} from './deezer.ts';
import type { DeezerArtistCandidate } from '../../types/artistImages.ts';

function candidate(
  id: string,
  name: string,
  fanCount: number
): DeezerArtistCandidate {
  return {
    provider: 'deezer',
    id,
    name,
    fanCount,
    albumCount: 1,
    imageUrl: `https://example.test/${id}.jpg`,
    linkUrl: `https://www.deezer.com/artist/${id}`,
  };
}

test('normalizes Unicode, punctuation, case, and whitespace for exact matching', () => {
  assert.equal(normalizeArtistImageMatchName('  Sigur   Rós! '), 'sigur ros');
  assert.equal(normalizeArtistImageMatchName('ＢＯＡ'), 'boa');
  assert.equal(normalizeArtistImageMatchName('AC/DC'), 'ac dc');
});

// Every real Deezer CDN URL ends in the "-000000-80-0-0" transform suffix, so
// these fixtures must keep it — inventing shorter URLs hides placeholder-filter
// bugs that would drop 100% of live results.
const REAL_IMAGE_URL =
  'https://cdn-images.dzcdn.net/images/artist/96b688020014a21cb80a0268b90287f5/1000x1000-000000-80-0-0.jpg';
const EMPTY_HASH_IMAGE_URL =
  'https://cdn-images.dzcdn.net/images/artist//1000x1000-000000-80-0-0.jpg';
const ZERO_BYTE_HASH_IMAGE_URL =
  'https://cdn-images.dzcdn.net/images/artist/d41d8cd98f00b204e9800998ecf8427e/1000x1000-000000-80-0-0.jpg';

test('accepts valid Deezer artists and drops corrupt or placeholder images', () => {
  const parsed = parseDeezerArtistPayload({
    data: [
      {
        id: 7,
        name: 'Artist',
        picture_xl: REAL_IMAGE_URL,
        link: 'https://www.deezer.com/artist/7',
        nb_fan: 120,
        nb_album: 4,
      },
      { id: 8, name: 'Empty Hash', picture_xl: EMPTY_HASH_IMAGE_URL },
      { id: 11, name: 'Zero Byte Hash', picture_xl: ZERO_BYTE_HASH_IMAGE_URL },
      { id: 9, name: '', picture_xl: 'https://cdn.test/9.jpg' },
      { id: 10, name: 'Unsafe', picture_xl: 'http://cdn.test/10.jpg' },
    ],
  });
  assert.deepEqual(parsed, [
    {
      provider: 'deezer',
      id: '7',
      name: 'Artist',
      imageUrl: REAL_IMAGE_URL,
      linkUrl: 'https://www.deezer.com/artist/7',
      fanCount: 120,
      albumCount: 4,
    },
  ]);
  assert.equal(parseDeezerArtistPayload({ nope: [] }), null);
});

test('automatic selection only accepts normalized exact names', () => {
  const candidates = [
    candidate('1', 'The National Tribute', 9_000),
    candidate('2', 'The National', 200),
  ];
  assert.equal(pickAutomaticDeezerCandidate('The National', candidates)?.id, '2');
  assert.equal(pickAutomaticDeezerCandidate('National', candidates), null);
});

test('same-name matches rank by fans, then stable numeric id', () => {
  const candidates = [
    candidate('40', 'Björk', 50),
    candidate('7', 'Bjork', 100),
    candidate('3', 'BJÖRK', 100),
  ];
  assert.equal(pickAutomaticDeezerCandidate('Björk', candidates)?.id, '3');
});

test('empty results are terminal while rate limits remain retryable', async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () =>
      new Response(JSON.stringify({ data: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    assert.deepEqual(await searchDeezerArtists('Nobody'), {
      status: 'success',
      candidates: [],
    });

    globalThis.fetch = async () => new Response('', { status: 429 });
    const limited = await searchDeezerArtists('Somebody');
    assert.equal(limited.status, 'transient_error');
    if (limited.status === 'transient_error') {
      assert.equal(limited.code, 'rate_limited');
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('an automatic request can be cancelled without becoming a failed lookup', async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = (_input, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          reject(new DOMException('Aborted', 'AbortError'));
        });
      });
    const controller = new AbortController();
    const request = searchDeezerArtists('Pause Me', controller.signal);
    controller.abort();
    const result = await request;
    assert.equal(result.status, 'transient_error');
    if (result.status === 'transient_error') assert.equal(result.code, 'cancelled');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

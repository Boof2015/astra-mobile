import assert from 'node:assert/strict';
import test from 'node:test';
import { ArtworkAccentCache } from './artworkAccentCache.ts';
import { extractArtworkAccentFromPixels } from './artworkAccentMath.ts';

type Pixel = [number, number, number, number?];

function pixels(entries: Array<{ pixel: Pixel; count: number }>): Uint8Array {
  const values: number[] = [];
  for (const { pixel, count } of entries) {
    for (let index = 0; index < count; index += 1) {
      values.push(pixel[0], pixel[1], pixel[2], pixel[3] ?? 255);
    }
  }
  return Uint8Array.from(values);
}

function rgb(hex: string): [number, number, number] {
  return [
    Number.parseInt(hex.slice(1, 3), 16),
    Number.parseInt(hex.slice(3, 5), 16),
    Number.parseInt(hex.slice(5, 7), 16),
  ];
}

test('transparent artwork has no usable accent', () => {
  const transparent = pixels([{ pixel: [255, 0, 0, 0], count: 20 }]);
  assert.equal(extractArtworkAccentFromPixels(transparent, 'average'), null);
  assert.equal(extractArtworkAccentFromPixels(transparent, 'dominant'), null);
  assert.equal(extractArtworkAccentFromPixels(transparent, 'vibrant'), null);
});

test('dominant extraction favors the largest usable color bucket', () => {
  const sample = pixels([
    { pixel: [225, 30, 40], count: 30 },
    { pixel: [30, 60, 220], count: 5 },
    { pixel: [255, 255, 255], count: 20 },
  ]);
  const result = extractArtworkAccentFromPixels(sample, 'dominant');
  assert.ok(result);
  const [r, g, b] = rgb(result);
  assert.ok(r > g * 2 && r > b * 2, result);
});

test('vibrant extraction can prefer a richer smaller bucket', () => {
  const sample = pixels([
    { pixel: [115, 125, 130], count: 80 },
    { pixel: [20, 220, 90], count: 20 },
  ]);
  const result = extractArtworkAccentFromPixels(sample, 'vibrant');
  assert.ok(result);
  const [r, g, b] = rgb(result);
  assert.ok(g > r * 2 && g > b, result);
});

test('average extraction ignores transparent pixels and normalizes the result', () => {
  const sample = pixels([
    { pixel: [20, 80, 220], count: 10 },
    { pixel: [255, 0, 0, 0], count: 50 },
  ]);
  const result = extractArtworkAccentFromPixels(sample, 'average');
  assert.ok(result);
  const [r, g, b] = rgb(result);
  assert.ok(b > r && b > g, result);
});

test('artwork accent cache is LRU and distinguishes a cached null', () => {
  const cache = new ArtworkAccentCache(2);
  cache.set('a', '#aa0000');
  cache.set('b', null);
  assert.deepEqual(cache.get('a'), { found: true, value: '#aa0000' });
  cache.set('c', '#00cc00');
  assert.deepEqual(cache.get('b'), { found: false, value: null });
  assert.deepEqual(cache.get('a'), { found: true, value: '#aa0000' });
  assert.deepEqual(cache.get('c'), { found: true, value: '#00cc00' });
  assert.equal(cache.size, 2);
});

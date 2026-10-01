import assert from 'node:assert/strict';
import test from 'node:test';
import { ArtworkAccentCache, artworkAccentCacheKey } from './artworkAccentCache.ts';
import { extractArtworkAccentFromPixels } from './artworkAccentMath.ts';
import { extractAdaptiveAccent } from './adaptiveAccent.ts';
import { parseCoverArtAccentMethod } from './artworkAccentPreferences.ts';
import { paletteWithAccent } from './scopedAccent.ts';
import { resolveTheme } from './resolve.ts';

const DARK = { isLight: false, onAccent: '#080a0f' };
const LIGHT = { isLight: true, onAccent: '#ffffff' };

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
  assert.equal(extractArtworkAccentFromPixels(transparent, 'adaptive', DARK), null);
});

test('Adaptive defaults only missing or invalid preferences, preserving saved methods', () => {
  for (const value of [null, '', 'unknown']) {
    assert.equal(parseCoverArtAccentMethod(value), 'adaptive');
  }
  for (const method of ['adaptive', 'dominant', 'vibrant', 'average']) {
    assert.equal(parseCoverArtAccentMethod(method), method);
  }
});

test('Adaptive retains the app fallback for empty samples and pixels below its alpha cutoff', () => {
  assert.equal(extractArtworkAccentFromPixels(new Uint8Array(), 'adaptive', DARK), null);
  const invisible = pixels([{ pixel: [255, 0, 0, 47], count: 100 }]);
  assert.equal(extractArtworkAccentFromPixels(invisible, 'adaptive', DARK), null);
  const visible = pixels([{ pixel: [255, 0, 0, 48], count: 100 }]);
  assert.equal(
    extractArtworkAccentFromPixels(visible, 'adaptive', DARK),
    extractAdaptiveAccent(visible, DARK).hex,
  );
});

test('Adaptive keeps visible grayscale neutral throughout scoped palette derivation', () => {
  const sample = pixels([
    { pixel: [0, 0, 0], count: 20 },
    { pixel: [255, 255, 255], count: 20 },
    { pixel: [120, 120, 120], count: 20 },
  ]);
  for (const baseTheme of ['midnight', 'dark', 'amoled', 'light'] as const) {
    const theme = resolveTheme({
      baseTheme,
      preferredDark: 'midnight',
      accentPreference: { kind: 'preset', id: 'indigo' },
      systemScheme: 'dark',
      materialYouRamps: null,
    });
    const accent = extractArtworkAccentFromPixels(sample, 'adaptive', {
      isLight: !theme.isDark,
      onAccent: theme.colors.bgPrimary,
    });
    assert.ok(accent);
    const scoped = paletteWithAccent(theme.colors, accent, theme.isDark);
    assert.equal(scoped.accent, accent);
    assert.equal(scoped.bgPrimary, theme.colors.bgPrimary);
    for (const token of [scoped.accent, scoped.accentHover, scoped.accentText, scoped.accentTextStrong]) {
      const channels = rgb(token);
      assert.ok(Math.max(...channels) - Math.min(...channels) <= 2, token);
    }
  }
});

test('Adaptive caches distinguish theme, foreground, artwork source, identity, and method', () => {
  const key = artworkAccentCacheKey('phone:album', 'source-a', 'adaptive', DARK);
  const cache = new ArtworkAccentCache();
  cache.set(key, '#abcdef');
  assert.equal(cache.get(artworkAccentCacheKey('phone:album', 'source-a', 'adaptive', { ...DARK })).value, '#abcdef');
  for (const changedKey of [
    artworkAccentCacheKey('phone:album', 'source-a', 'adaptive', { ...DARK, isLight: true }),
    artworkAccentCacheKey('phone:album', 'source-a', 'adaptive', { ...DARK, onAccent: '#000000' }),
    artworkAccentCacheKey('phone:album', 'source-b', 'adaptive', DARK),
    artworkAccentCacheKey('desktop:album', 'source-a', 'adaptive', DARK),
    artworkAccentCacheKey('phone:album', 'source-a', 'dominant', DARK),
  ]) {
    assert.equal(cache.get(changedKey).found, false);
  }
});

test('legacy methods remain independent of Adaptive theme targets', () => {
  const sample = pixels([
    { pixel: [30, 100, 200], count: 100 },
    { pixel: [240, 60, 100], count: 40 },
  ]);
  for (const method of ['dominant', 'vibrant', 'average'] as const) {
    assert.equal(
      artworkAccentCacheKey('album', 'source', method, DARK),
      artworkAccentCacheKey('album', 'source', method, LIGHT),
    );
    assert.equal(
      extractArtworkAccentFromPixels(sample, method, DARK),
      extractArtworkAccentFromPixels(sample, method, LIGHT),
    );
  }
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

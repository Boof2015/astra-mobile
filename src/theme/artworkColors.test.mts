import assert from 'node:assert/strict';
import test from 'node:test';
import { artworkColorsFromPixels } from './artworkColors.ts';
import { extractArtworkAccentFromPixels } from './artworkAccentMath.ts';
import { fieldFromPixels } from './artworkField.ts';

const DARK = { isLight: false, onAccent: '#080a0f' };
const LIGHT = { isLight: true, onAccent: '#ffffff' };

function photo(size: number, seed: number): Uint8Array {
  const pixels = new Uint8Array(size * size * 4);
  let s = seed;
  const rnd = () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      pixels[i] = (x / size) * 200 + rnd() * 55;
      pixels[i + 1] = (y / size) * 120 + rnd() * 75;
      pixels[i + 2] = ((x + y) / (2 * size)) * 230 + rnd() * 25;
      pixels[i + 3] = 255;
    }
  }
  return pixels;
}

test('one clustering pass gives the same accent and field as the two separate extractions', () => {
  for (const seed of [3, 41, 977]) {
    const pixels = photo(64, seed);
    for (const [target, isDark] of [[DARK, true], [LIGHT, false]] as const) {
      for (const method of ['adaptive', 'dominant', 'vibrant', 'average'] as const) {
        const combined = artworkColorsFromPixels(pixels, { method, target }, isDark);
        assert.equal(combined.accent, extractArtworkAccentFromPixels(pixels, method, target), `${method} accent`);
        assert.deepEqual(combined.field, fieldFromPixels(pixels, isDark), `${method} field`);
      }
    }
  }
});

test('no accent request still yields the field', () => {
  const colors = artworkColorsFromPixels(photo(32, 5), null, true);
  assert.equal(colors.accent, null);
  assert.ok(colors.field);
});

test('a fully transparent sample has no adaptive accent', () => {
  const clear = new Uint8Array(32 * 32 * 4);
  assert.equal(artworkColorsFromPixels(clear, { method: 'adaptive', target: DARK }, true).accent, null);
});

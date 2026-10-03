import assert from 'node:assert/strict';
import test from 'node:test';
import { chromaOf, hueOf, rgbToOklab } from './adaptiveAccent.ts';
import { FIELD_SIZE, fieldFromPixels, oklchToHex } from './artworkField.ts';

type Rgb = [number, number, number];

/** A flat pixel buffer made of runs: [[color, pixelCount], …]. */
function image(runs: Array<[Rgb, number]>): Uint8ClampedArray {
  const total = runs.reduce((sum, [, count]) => sum + count, 0);
  const pixels = new Uint8ClampedArray(total * 4);
  let offset = 0;
  for (const [[r, g, b], count] of runs) {
    for (let i = 0; i < count; i++) {
      pixels.set([r, g, b, 255], offset);
      offset += 4;
    }
  }
  return pixels;
}

function lab(hex: string) {
  const value = parseInt(hex.slice(1), 16);
  return rgbToOklab((value >> 16) & 255, (value >> 8) & 255, value & 255);
}

function hueGap(a: number, b: number): number {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

const SUNSET = image([
  [[179, 58, 28], 2400], // red-orange sky, most of the cover
  [[240, 137, 44], 900], // orange band
  [[40, 70, 160], 500], // a blue sail
  [[26, 7, 16], 300], // near-black hills
]);

test('always returns FIELD_SIZE solid hex colors', () => {
  for (const isDark of [true, false]) {
    const field = fieldFromPixels(SUNSET, isDark);
    assert.ok(field);
    assert.equal(field.colors.length, FIELD_SIZE);
    for (const color of field.colors) assert.match(color, /^#[0-9a-f]{6}$/);
  }
});

test('leads with what most of the cover looks like, and keeps its distinct hues', () => {
  const field = fieldFromPixels(SUNSET, true);
  assert.ok(field);
  assert.equal(field.neutral, false);
  const hues = field.colors.map((color) => hueOf(lab(color)));
  const sky = hueOf(rgbToOklab(179, 58, 28));
  const sail = hueOf(rgbToOklab(40, 70, 160));
  assert.ok(hueGap(hues[0], sky) < 20, `first color should be the sky's hue, got ${hues[0]}`);
  assert.ok(
    hues.some((hue) => hueGap(hue, sail) < 25),
    `a small but distinct hue should survive, got ${hues.join(', ')}`,
  );
});

test('tones each theme into its own lightness band', () => {
  const dark = fieldFromPixels(SUNSET, true);
  const light = fieldFromPixels(SUNSET, false);
  assert.ok(dark && light);
  for (const color of dark.colors) {
    const { L } = lab(color);
    assert.ok(L > 0.32 && L < 0.5, `dark field lightness ${L} out of band`);
  }
  for (const color of light.colors) {
    const { L } = lab(color);
    assert.ok(L > 0.78 && L < 0.94, `light field lightness ${L} out of band`);
  }
});

test('a grey cover yields a grey field and says so', () => {
  const concrete = image([
    [[110, 110, 106], 2000],
    [[58, 58, 56], 1500],
    [[154, 154, 149], 800],
  ]);
  const field = fieldFromPixels(concrete, true);
  assert.ok(field);
  assert.equal(field.neutral, true);
  for (const color of field.colors) {
    assert.ok(chromaOf(lab(color)) < 0.02, `${color} should be near-grey`);
  }
});

test('a single-color cover still fills every slot from that color', () => {
  const flat = image([[[30, 120, 90], 4000]]);
  const field = fieldFromPixels(flat, true);
  assert.ok(field);
  assert.equal(field.colors.length, FIELD_SIZE);
  const hue = hueOf(rgbToOklab(30, 120, 90));
  for (const color of field.colors) assert.ok(hueGap(hueOf(lab(color)), hue) < 15);
});

test('an empty image has no field', () => {
  assert.equal(fieldFromPixels(new Uint8ClampedArray(0), true), null);
});

test('oklchToHex reduces chroma to stay in gamut instead of clipping hue', () => {
  const hex = oklchToHex(0.42, 0.4, 145); // far outside sRGB at this lightness
  const out = lab(hex);
  assert.ok(Math.abs(out.L - 0.42) < 0.02);
  assert.ok(hueGap(hueOf(out), 145) < 4);
});

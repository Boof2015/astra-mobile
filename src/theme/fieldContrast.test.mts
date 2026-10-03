import assert from 'node:assert/strict';
import test from 'node:test';
import { fieldFromPixels } from './artworkField.ts';
import {
  contrastRatio,
  fieldStrength,
  paletteOverField,
  worstFieldSurface,
} from './fieldContrast.ts';
import { deriveAccentFromHex } from './accents.ts';
import { lightBase, midnightBase, type Palette } from './palettes.ts';

const MIDNIGHT: Palette = { ...midnightBase, ...deriveAccentFromHex('#7c86f0', true) };
const LIGHT: Palette = { ...lightBase, ...deriveAccentFromHex('#4a55c8', false) };

function image(runs: Array<[[number, number, number], number]>): Uint8ClampedArray {
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

// The device-pass cover: pale lavender and periwinkle line art on near-white.
const LAVENDER = image([
  [[196, 200, 240], 2200],
  [[110, 118, 214], 1300],
  [[60, 64, 150], 700],
  [[24, 22, 48], 400],
]);

test('every lifted token clears its floor over the brightest the field can get', () => {
  for (const [palette, isDark] of [[MIDNIGHT, true], [LIGHT, false]] as const) {
    const field = fieldFromPixels(LAVENDER, isDark);
    assert.ok(field);
    const adjusted = paletteOverField(palette, field, isDark);
    const surface = worstFieldSurface(palette.bgPrimary, field.colors, fieldStrength(isDark, field.neutral), isDark);
    assert.ok(contrastRatio(adjusted.textSecondary, surface) >= 4.5, `secondary (${isDark ? 'dark' : 'light'})`);
    assert.ok(contrastRatio(adjusted.textTertiary, surface) >= 3, `tertiary (${isDark ? 'dark' : 'light'})`);
    assert.ok(contrastRatio(adjusted.accentText, surface) >= 4.5, `accent text (${isDark ? 'dark' : 'light'})`);
    assert.ok(contrastRatio(adjusted.textPrimary, surface) >= 7, 'primary text was already fine and stays put');
  }
});

test('the bright cover actually needed the lift (this is the readability bug)', () => {
  const field = fieldFromPixels(LAVENDER, true);
  assert.ok(field);
  const surface = worstFieldSurface(MIDNIGHT.bgPrimary, field.colors, fieldStrength(true, false), true);
  assert.ok(contrastRatio(MIDNIGHT.textTertiary, surface) < 3, 'stock tertiary should fail here');
  assert.notEqual(paletteOverField(MIDNIGHT, field, true).textTertiary, MIDNIGHT.textTertiary);
});

test('lifts only as far as needed, and only the quiet tokens', () => {
  // A field that stays close to the background leaves text tokens alone.
  const dim = { colors: ['#0e1018', '#0c0e15', '#101320'], neutral: false };
  const adjusted = paletteOverField(MIDNIGHT, dim, true);
  assert.equal(adjusted.textSecondary, MIDNIGHT.textSecondary);
  assert.equal(adjusted.textTertiary, MIDNIGHT.textTertiary);
  assert.equal(adjusted.textPrimary, MIDNIGHT.textPrimary);
  assert.equal(adjusted.accent, MIDNIGHT.accent);
  assert.equal(adjusted.bgPrimary, MIDNIGHT.bgPrimary);
});

test('solid tokens stay six-digit hex (the Skia visualizers slice them)', () => {
  const field = fieldFromPixels(LAVENDER, true);
  const adjusted = paletteOverField(MIDNIGHT, field, true);
  for (const key of ['textSecondary', 'textTertiary', 'accentText'] as const) {
    assert.match(adjusted[key], /^#[0-9a-f]{6}$/i);
  }
});

test('no field leaves the palette untouched', () => {
  assert.equal(paletteOverField(MIDNIGHT, null, true), MIDNIGHT);
});

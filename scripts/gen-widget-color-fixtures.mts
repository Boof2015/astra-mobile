/**
 * Regenerates the parity fixtures for the widget's native color port
 * (modules/astra-widget/.../ArtworkColorMath.kt). Run after changing any of
 * adaptiveAccent.ts, artworkField.ts, fieldContrast.ts or colorUtils.ts, then
 * run the Kotlin test so the port is updated to match:
 *
 *   node --experimental-strip-types scripts/gen-widget-color-fixtures.mts
 *   (cd android && ./gradlew :astra-widget:testDebugUnitTest)
 */
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { scoreColors, toneForTheme } from '../src/theme/adaptiveAccent.ts';
import { clusterArtworkPixels, fieldFromClusters, oklchToHex } from '../src/theme/artworkField.ts';
import { hexToHsl, hslToHex, mixHex } from '../src/theme/colorUtils.ts';
import { fieldStrength, liftToContrast, worstFieldSurface } from '../src/theme/fieldContrast.ts';

const OUT = fileURLToPath(
  new URL('../modules/astra-widget/android/src/test/resources/artwork-color-fixtures.json', import.meta.url),
);
// palettes.ts: the text drawn on accent fills is bgPrimary.
const ON_ACCENT_DARK = '#080a0f';
const ON_ACCENT_LIGHT = '#f4f6fb';

function rng(seed: number) {
  let state = seed | 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Paint = (x: number, y: number, size: number, random: () => number) => [number, number, number, number];

function image(size: number, seed: number, paint: Paint): Uint8Array {
  const random = rng(seed);
  const pixels = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const [r, g, b, a] = paint(x, y, size, random);
      const i = (y * size + x) * 4;
      pixels[i] = r;
      pixels[i + 1] = g;
      pixels[i + 2] = b;
      pixels[i + 3] = a;
    }
  }
  return pixels;
}

const jitter = (value: number, random: () => number, amount: number) =>
  Math.max(0, Math.min(255, Math.round(value + (random() - 0.5) * amount)));

function hsv(h: number, s: number, v: number): [number, number, number] {
  const c = v * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - c;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
}

const CASES: { name: string; size: number; seed: number; paint: Paint }[] = [
  { name: 'magenta-cyan', size: 32, seed: 1, paint: (x, _y, size, r) => (x < size / 2 ? [jitter(255, r, 20), jitter(43, r, 20), jitter(214, r, 20), 255] : [jitter(24, r, 20), jitter(224, r, 20), jitter(255, r, 20), 255]) },
  { name: 'warm-gradient', size: 32, seed: 2, paint: (_x, y, size, r) => { const t = y / (size - 1); return [jitter(255 - 145 * t, r, 10), jitter(210 - 168 * t, r, 10), jitter(127 - 96 * t, r, 10), 255]; } },
  { name: 'greens', size: 32, seed: 3, paint: (_x, _y, _s, r) => { const pick = [[47, 143, 87], [108, 199, 127], [29, 122, 116], [14, 39, 28]][Math.floor(r() * 4)]; return [jitter(pick[0], r, 16), jitter(pick[1], r, 16), jitter(pick[2], r, 16), 255]; } },
  { name: 'greys', size: 32, seed: 4, paint: (x, y, _s, r) => { const v = (x + y) % 3 === 0 ? 40 : (x * y) % 5 === 0 ? 200 : 128; const g = jitter(v, r, 12); return [g, g, g, 255]; } },
  { name: 'near-black-red', size: 32, seed: 5, paint: (x, y, _s, r) => (Math.hypot(x - 20, y - 14) < 3 ? [jitter(255, r, 8), jitter(42, r, 8), jitter(42, r, 8), 255] : [jitter(10, r, 6), jitter(10, r, 6), jitter(14, r, 6), 255]) },
  { name: 'pastels', size: 32, seed: 6, paint: (x, y, _s, r) => { const pick = [[255, 214, 230], [255, 242, 184], [205, 239, 253], [255, 225, 199]][(Math.floor(x / 8) + Math.floor(y / 8)) % 4]; return [jitter(pick[0], r, 6), jitter(pick[1], r, 6), jitter(pick[2], r, 6), 255]; } },
  { name: 'solid-blue', size: 16, seed: 7, paint: () => [40, 90, 220, 255] },
  { name: 'transparent', size: 16, seed: 8, paint: () => [200, 30, 30, 0] },
  { name: 'noise', size: 32, seed: 9, paint: (_x, _y, _s, r) => [Math.floor(r() * 256), Math.floor(r() * 256), Math.floor(r() * 256), r() < 0.1 ? 20 : 255] },
  { name: 'hue-wheel', size: 64, seed: 10, paint: (x, y, size, r) => { const [cr, cg, cb] = hsv((Math.atan2(y - size / 2, x - size / 2) * 180 / Math.PI + 360) % 360, 0.85, 0.9); return [jitter(cr, r, 4), jitter(cg, r, 4), jitter(cb, r, 4), 255]; } },
  { name: 'desert-cover', size: 48, seed: 11, paint: (x, y, size, r) => { if (Math.hypot(x - size / 2, y - size * 0.45) < size * 0.2) return [255, 240, 196, 255]; const t = y / size; return y > size * 0.75 ? [jitter(126, r, 10), jitter(53, r, 10), jitter(24, r, 10), 255] : [jitter(255 - 13 * t * 4, r, 8), jitter(210 - 80 * t, r, 8), jitter(127 - 60 * t, r, 8), 255]; } },
];

const cases = CASES.map(({ name, size, seed, paint }) => {
  const pixels = image(size, seed, paint);
  const clusters = clusterArtworkPixels(pixels);
  const visible = pixels.some((value, index) => index % 4 === 3 && value >= 48);
  const source = scoreColors(clusters)[0]?.lab ?? null;
  return {
    name,
    pixels: Buffer.from(pixels).toString('base64'),
    clusterCount: clusters.length,
    fieldDark: fieldFromClusters(clusters, true),
    fieldLight: fieldFromClusters(clusters, false),
    accentDark: visible ? toneForTheme(source, { isLight: false, onAccent: ON_ACCENT_DARK }) : null,
    accentLight: visible ? toneForTheme(source, { isLight: true, onAccent: ON_ACCENT_LIGHT }) : null,
  };
});

const random = rng(99);
const hex = () => `#${Math.floor(random() * 0xffffff).toString(16).padStart(6, '0')}`;
const helpers = {
  oklch: Array.from({ length: 24 }, () => {
    const L = random();
    const chroma = random() * 0.3;
    const hue = random() * 360;
    return { L, chroma, hue, hex: oklchToHex(L, chroma, hue) };
  }),
  mix: Array.from({ length: 16 }, () => {
    const a = hex();
    const b = hex();
    const t = random();
    return { a, b, t, hex: mixHex(a, b, t) };
  }),
  hsl: Array.from({ length: 16 }, () => {
    const source = hex();
    const [h, s, l] = Object.values(hexToHsl(source));
    return { source, h, s, l, back: hslToHex(h, s, 83) };
  }),
  lift: Array.from({ length: 16 }, () => {
    const background = random() < 0.5 ? ON_ACCENT_DARK : ON_ACCENT_LIGHT;
    const isDark = background === ON_ACCENT_DARK;
    const field = [hex(), hex(), hex()];
    const strength = fieldStrength(isDark, random() < 0.3);
    const surface = worstFieldSurface(background, field, strength, isDark);
    const color = hex();
    const toward = isDark ? '#e2e8f4' : '#171d2e';
    return { background, isDark, field, strength, surface, color, toward, lifted: liftToContrast(color, toward, surface, 4.5) };
  }),
};

writeFileSync(OUT, `${JSON.stringify({ onAccentDark: ON_ACCENT_DARK, onAccentLight: ON_ACCENT_LIGHT, cases, helpers }, null, 1)}\n`);
console.log(`wrote ${cases.length} cases to ${OUT}`);

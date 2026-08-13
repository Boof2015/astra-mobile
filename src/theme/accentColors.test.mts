import assert from 'node:assert/strict';
import test from 'node:test';
import {
  deriveAccentFromHex,
  parseAccentPreference,
  serializeAccentPreference,
} from './accents.ts';
import {
  hexToHsv,
  hsvToHex,
  normalizeHexColor,
} from './colorUtils.ts';
import { resolveTheme } from './resolve.ts';
import { paletteWithAccent } from './scopedAccent.ts';

test('parses legacy preset ids and normalized custom colors', () => {
  assert.deepEqual(parseAccentPreference('cyan'), { kind: 'preset', id: 'cyan' });
  assert.deepEqual(parseAccentPreference('#AbC'), { kind: 'custom', hex: '#aabbcc' });
  assert.deepEqual(parseAccentPreference('12ef90'), { kind: 'custom', hex: '#12ef90' });
  assert.deepEqual(parseAccentPreference('nope'), { kind: 'preset', id: 'indigo' });
  assert.equal(
    serializeAccentPreference({ kind: 'custom', hex: '#12ef90' }),
    '#12ef90',
  );
});

test('normalizes hex and round-trips HSV colors', () => {
  assert.equal(normalizeHexColor(' ABC '), '#aabbcc');
  assert.equal(normalizeHexColor('#12Ef90'), '#12ef90');
  assert.equal(normalizeHexColor('#12zz90'), null);
  for (const hex of ['#ff0000', '#2dd4a0', '#5b8aff', '#000000', '#ffffff']) {
    const hsv = hexToHsv(hex);
    assert.equal(hsvToHex(hsv.h, hsv.s, hsv.v), hex);
  }
});

test('derives complete light and dark ramps from a custom accent', () => {
  const dark = deriveAccentFromHex('#2dd4a0', true);
  const light = deriveAccentFromHex('#2dd4a0', false);
  assert.equal(dark.accent, '#2dd4a0');
  assert.equal(light.accent, '#2dd4a0');
  assert.notEqual(dark.accentTextStrong, light.accentTextStrong);
  assert.match(dark.accentGlow, /^rgba\(45, 212, 160, 0\.3\)$/);
});

test('static themes use custom accents while Material You ignores them', () => {
  const custom = { kind: 'custom', hex: '#123456' } as const;
  const staticTheme = resolveTheme({
    baseTheme: 'dark',
    preferredDark: 'dark',
    accentPreference: custom,
    systemScheme: 'dark',
    materialYouRamps: null,
  });
  assert.equal(staticTheme.colors.accent, '#123456');

  const ramp = Array.from({ length: 13 }, (_, index) => {
    const channel = Math.max(0, 255 - index * 16).toString(16).padStart(2, '0');
    return `#${channel}${channel}${channel}`;
  });
  const materialInput = {
    baseTheme: 'materialYou' as const,
    preferredDark: 'dark' as const,
    systemScheme: 'dark' as const,
    materialYouRamps: {
      accent1: ramp,
      accent2: ramp,
      accent3: ramp,
      neutral1: ramp,
      neutral2: ramp,
    },
  };
  const materialCustom = resolveTheme({
    ...materialInput,
    accentPreference: custom,
  });
  const materialPreset = resolveTheme({
    ...materialInput,
    accentPreference: { kind: 'preset', id: 'crimson' },
  });
  assert.deepEqual(materialCustom.colors, materialPreset.colors);
});

test('scoped palettes replace only accent tokens', () => {
  const theme = resolveTheme({
    baseTheme: 'midnight',
    preferredDark: 'midnight',
    accentPreference: { kind: 'preset', id: 'indigo' },
    systemScheme: 'dark',
    materialYouRamps: null,
  });
  const scoped = paletteWithAccent(theme.colors, '#ff5c5c', true);
  assert.equal(scoped.accent, '#ff5c5c');
  for (const key of Object.keys(theme.colors)) {
    if (['accent', 'accentHover', 'accentGlow', 'accentText', 'accentTextStrong'].includes(key)) {
      continue;
    }
    assert.equal(
      scoped[key as keyof typeof scoped],
      theme.colors[key as keyof typeof theme.colors],
      key,
    );
  }
  assert.equal(paletteWithAccent(theme.colors, null, true), theme.colors);
});

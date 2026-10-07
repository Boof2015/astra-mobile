import assert from 'node:assert/strict';
import test from 'node:test';
import { settingsEntry, settingsWindow, settingsTextPages, adjustSetting } from './settingsModel.ts';
import { tvPalette } from './tvTheme.ts';
import { resolveTheme } from '../theme/resolve.ts';

test('section entry remembers identity and falls back when a dependency disables it', () => {
  const rows = [{ id: 'output' }, { id: 'normalization' }, { id: 'target', disabled: true }, { id: 'replaygain' }];
  assert.equal(settingsEntry(rows, 'replaygain'), 'replaygain');
  assert.equal(settingsEntry(rows, 'target'), 'output');
  assert.equal(settingsEntry(rows.map(row => ({ ...row, disabled: true })), 'output'), null);
  assert.equal(settingsEntry([], 'gone'), null);
});
test('settings windows retain a next row and stay inside either end', () => {
  assert.equal(settingsWindow(0, 11), 0);
  assert.equal(settingsWindow(5, 11), 1);
  assert.equal(settingsWindow(10, 11), 5);
  assert.equal(settingsWindow(4, 5), 0);
});
test('a grabbed setting owns vertical directions and clamps horizontal changes', () => {
  assert.equal(adjustSetting(-14, 'right', -30, -5), -13);
  assert.equal(adjustSetting(-14, 'left', -30, -5), -15);
  assert.equal(adjustSetting(-14, 'down', -30, -5), -14);
  assert.equal(adjustSetting(-14, 'up', -30, -5), -14);
  assert.equal(adjustSetting(-30, 'left', -30, -5), -30);
  assert.equal(adjustSetting(-5, 'right', -30, -5), -5);
});
test('document pagination keeps all text and bounds each page and line', () => {
  const text = `${'License words '.repeat(600)}\n\n${'x'.repeat(200)}\nEnd.`;
  const pages = settingsTextPages(text);
  assert.ok(pages.length > 1);
  assert.equal(pages.join('').replace(/\s/g, ''), text.replace(/\s/g, ''));
  assert.ok(pages.every(page => page.split('\n').length <= 15 && page.split('\n').every(line => line.length <= 84)));
  assert.deepEqual(settingsTextPages(''), ['']);
});
test('TV palettes retain Midnight defaults and provide contrasting light focus and changing accents', () => {
  const theme = (baseTheme: 'midnight' | 'light', id: 'indigo' | 'violet') => tvPalette(resolveTheme({ baseTheme, preferredDark: 'midnight', systemScheme: 'dark', materialYouRamps: null, accentPreference: { kind: 'preset', id } }));
  const midnight = theme('midnight', 'indigo'); const light = theme('light', 'indigo');
  assert.equal(midnight.bg, '#080a0f'); assert.equal(midnight.accent, '#a9c0ff'); assert.equal(midnight.focus, '#e8eeff');
  assert.notEqual(light.focus, midnight.focus); assert.notEqual(light.panel, midnight.panel);
  assert.notEqual(theme('midnight', 'violet').accent, midnight.accent);
});

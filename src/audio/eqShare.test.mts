import assert from 'node:assert/strict';
import test from 'node:test';
import type { EQBand, EQPreset } from '../types/audio.ts';
import { EQ_MAX_BANDS } from './eq.ts';
import {
  EQ_PRESET_QR_PREFIX,
  decodeEQPresetQr,
  encodeEQPresetQr,
  parseEQPresetFileContents,
  stringifyEQPresetFileContents,
} from './eqShare.ts';

let idCounter = 0;
function nextId(): string {
  idCounter += 1;
  return `test-eq-${idCounter}`;
}

function band(overrides: Partial<EQBand> = {}): EQBand {
  return {
    id: overrides.id ?? nextId(),
    type: overrides.type ?? 'peaking',
    frequency: overrides.frequency ?? 1000,
    gain: overrides.gain ?? 0,
    Q: overrides.Q ?? 1,
    enabled: overrides.enabled ?? true,
  };
}

test('round-trips a parametric Astra EQ preset file', () => {
  const source: EQPreset = {
    id: 'preset-parametric',
    name: 'Desk Parametric',
    preamp: -2.5,
    bands: [
      band({ type: 'lowshelf', frequency: 80, gain: 3.5, Q: 0.707 }),
      band({ type: 'peaking', frequency: 1200, gain: -2, Q: 1.4, enabled: false }),
    ],
  };

  const parsed = parseEQPresetFileContents(stringifyEQPresetFileContents(source), nextId);

  assert.equal(parsed.name, 'Desk Parametric');
  assert.equal(parsed.preamp, -2.5);
  assert.equal(parsed.mode, undefined);
  assert.deepEqual(
    parsed.bands.map((b) => ({ type: b.type, frequency: b.frequency, gain: b.gain, Q: b.Q, enabled: b.enabled })),
    [
      { type: 'lowshelf', frequency: 80, gain: 3.5, Q: 0.707, enabled: true },
      { type: 'peaking', frequency: 1200, gain: -2, Q: 1.4, enabled: false },
    ]
  );
});

test('round-trips a graphic Astra EQ preset file with editable gains', () => {
  const graphicGains = [-2, 0, 3, 2.5, -1];
  const source: EQPreset = {
    id: 'preset-graphic',
    name: 'Graphic Smile',
    preamp: -3,
    mode: 'graphic',
    graphicGains,
    bands: graphicGains.map((gain, index) =>
      band({ id: `graphic-${index}`, frequency: [60, 250, 1000, 4000, 12000][index], gain })
    ),
  };

  const parsed = parseEQPresetFileContents(stringifyEQPresetFileContents(source), nextId);

  assert.equal(parsed.mode, 'graphic');
  assert.deepEqual(parsed.graphicGains, graphicGains);
  assert.equal(parsed.bands.length, 5);
});

test('encodes and decodes a QR payload', () => {
  const source: EQPreset = {
    id: 'preset-qr',
    name: 'QR Preset ✓',
    preamp: 1,
    bands: [band({ frequency: 777, gain: 4, Q: 1.25 })],
  };

  const qr = encodeEQPresetQr(source);
  assert.ok(qr.startsWith(EQ_PRESET_QR_PREFIX));

  const parsed = decodeEQPresetQr(qr, nextId);
  assert.equal(parsed.name, 'QR Preset ✓');
  assert.equal(parsed.bands[0]?.frequency, 777);
});

test('rejects non-Astra and malformed QR payloads', () => {
  assert.throws(() => decodeEQPresetQr('https://example.com', nextId), /Not an Astra EQ preset QR/);
  assert.throws(() => decodeEQPresetQr(`${EQ_PRESET_QR_PREFIX}%`, nextId), /Invalid Astra EQ preset QR/);
});

test('rejects invalid preset JSON', () => {
  assert.throws(() => parseEQPresetFileContents('{not-json', nextId), /Invalid Astra EQ preset file/);
  assert.throws(
    () => parseEQPresetFileContents(JSON.stringify({ version: 2, name: 'Future', bands: [] }), nextId),
    /Unsupported preset version/
  );
});

test('clamps values and truncates imported bands', () => {
  const rawBands = Array.from({ length: EQ_MAX_BANDS + 3 }, (_, index) => ({
    type: index === 0 ? 'highpass' : 'peaking',
    frequency: index === 0 ? 5 : 50000,
    gain: 999,
    Q: 99,
    enabled: true,
  }));

  const parsed = parseEQPresetFileContents(JSON.stringify({ version: 1, name: 'Wild', preamp: -99, bands: rawBands }), nextId);

  assert.equal(parsed.preamp, -12);
  assert.equal(parsed.bands.length, EQ_MAX_BANDS);
  assert.equal(parsed.bands[0]?.frequency, 20);
  assert.equal(parsed.bands[0]?.gain, 0);
  assert.equal(parsed.bands[1]?.frequency, 20000);
  assert.equal(parsed.bands[1]?.gain, 12);
  assert.equal(parsed.bands[1]?.Q, 18);
});

test('does not serialize the master EQ enabled state', () => {
  const source = {
    id: 'preset-enabled',
    name: 'No Master State',
    preamp: 0,
    enabled: true,
    bands: [band()],
  } as EQPreset & { enabled: boolean };

  const raw = JSON.parse(stringifyEQPresetFileContents(source));
  assert.equal('enabled' in raw, false);
});

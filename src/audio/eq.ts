// Parametric EQ math + helpers. Audio EQ Cookbook biquad math drives the response
// curve in the EQ screen. Native playback computes matching coefficients in Kotlin
// at the real stream sample rate — here we also flatten band params for the bridge.

import type { EQBand, EQBandType, EQMode, EQPreset } from '../types/audio';

export const EQ_MIN_GAIN_DB = -12;
export const EQ_MAX_GAIN_DB = 12;
export const EQ_MIN_FREQUENCY = 20;
export const EQ_MAX_FREQUENCY = 20000;
export const EQ_MIN_Q = 0.1;
export const EQ_MAX_Q = 18;
export const EQ_PASS_FILTER_DEFAULT_Q = 0.707;
export const EQ_MAX_BANDS = 10;
export const EQ_MIN_PREAMP_DB = -12;
export const EQ_MAX_PREAMP_DB = 12;
export const EQ_PRESET_VERSION = 1;
export const EQ_GRAPHIC_BAND_COUNT = 5;
/** Slots in the band color palette (`src/components/eq/bandColors.ts`). */
export const EQ_BAND_COLOR_COUNT = 8;

// Ordinals MUST match the Kotlin `EqBandType` enum order in EqBridge.kt.
export const EQ_BAND_TYPE_ORDINAL: Record<EQBandType, number> = {
  lowshelf: 0,
  peaking: 1,
  highshelf: 2,
  highpass: 3,
  lowpass: 4,
};

interface RawEQBand {
  type?: unknown;
  frequency?: unknown;
  gain?: unknown;
  Q?: unknown;
  enabled?: unknown;
  color?: unknown;
}

type SerializedEQBand = Pick<EQBand, 'type' | 'frequency' | 'gain' | 'Q' | 'enabled'>;

export interface SerializedEQPresetData {
  version: number;
  name: string;
  preamp: number;
  bands: SerializedEQBand[];
  mode?: EQMode;
  graphicGains?: number[];
}

function clamp(value: number, min: number, max: number): number {
  'worklet';
  return Math.max(min, Math.min(max, value));
}

function coerceFiniteNumber(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function clampEQGain(value: number): number {
  'worklet';
  return clamp(value, EQ_MIN_GAIN_DB, EQ_MAX_GAIN_DB);
}

export function clampEQFrequency(value: number): number {
  'worklet';
  return clamp(value, EQ_MIN_FREQUENCY, EQ_MAX_FREQUENCY);
}

export function clampEQQ(value: number): number {
  'worklet';
  return clamp(value, EQ_MIN_Q, EQ_MAX_Q);
}

export function clampPreamp(value: number): number {
  return clamp(value, EQ_MIN_PREAMP_DB, EQ_MAX_PREAMP_DB);
}

export function normalizeEQBandType(value: unknown): EQBandType {
  switch (value) {
    case 'lowshelf':
    case 'peaking':
    case 'highshelf':
    case 'highpass':
    case 'lowpass':
      return value;
    default:
      return 'peaking';
  }
}

export function isPassEQBandType(type: EQBandType): boolean {
  'worklet';
  return type === 'highpass' || type === 'lowpass';
}

/** Pass filters carry no gain — force it to 0. */
export function normalizeEQBand<T extends EQBand>(band: T): T {
  if (!isPassEQBandType(band.type) || band.gain === 0) {
    return band;
  }
  return { ...band, gain: 0 };
}

export function createNormalizedEQBand(rawBand: RawEQBand, id: string): EQBand {
  const band: EQBand = {
    id,
    type: normalizeEQBandType(rawBand.type),
    frequency: clampEQFrequency(coerceFiniteNumber(rawBand.frequency, 1000)),
    gain: clampEQGain(coerceFiniteNumber(rawBand.gain, 0)),
    Q: clampEQQ(coerceFiniteNumber(rawBand.Q, 1.0)),
    enabled: rawBand.enabled === undefined ? true : rawBand.enabled !== false,
  };
  const color = normalizeEQBandColor(rawBand.color);
  if (color !== undefined) band.color = color;
  return normalizeEQBand(band);
}

/** A valid palette slot or '#rrggbb' custom color, or undefined for anything else. */
export function normalizeEQBandColor(value: unknown): number | string | undefined {
  if (typeof value === 'number') {
    return Number.isInteger(value) && value >= 0 && value < EQ_BAND_COLOR_COUNT ? value : undefined;
  }
  return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value) ? value.toLowerCase() : undefined;
}

/**
 * Where a newly added band should go: the middle (on the log axis) of the
 * widest empty stretch of the spectrum, counting the gaps out to 20 Hz and
 * 20 kHz, rounded to two significant figures. Repeated adds therefore spread
 * out — 120 Hz, then 500 Hz, then 2 kHz on the default bands — instead of
 * stacking on one spot. Ties go to the lower frequency.
 */
export function suggestEQBandFrequency(bands: readonly Pick<EQBand, 'frequency'>[]): number {
  const logs = bands.map((band) => Math.log10(clampEQFrequency(band.frequency))).sort((a, b) => a - b);
  const stops = [Math.log10(EQ_MIN_FREQUENCY), ...logs, Math.log10(EQ_MAX_FREQUENCY)];
  let best = 0;
  for (let i = 1; i < stops.length - 1; i++) {
    if (stops[i + 1] - stops[i] > stops[best + 1] - stops[best]) best = i;
  }
  const frequency = 10 ** ((stops[best] + stops[best + 1]) / 2);
  const step = 10 ** (Math.floor(Math.log10(frequency)) - 1);
  return clampEQFrequency(Math.round(frequency / step) * step);
}

/** The lowest palette slot no band is using; wraps once every slot is taken. */
export function nextFreeEQBandColor(bands: readonly Pick<EQBand, 'color'>[]): number {
  for (let slot = 0; slot < EQ_BAND_COLOR_COUNT; slot++) {
    if (!bands.some((band) => band.color === slot)) return slot;
  }
  return bands.length % EQ_BAND_COLOR_COUNT;
}

/**
 * Stamp a color on every band that lacks one (built-in presets, shared files,
 * installs from before band colors), in array order, without touching bands
 * that already have one. Returns the same array when nothing was missing.
 */
export function assignEQBandColors<T extends EQBand>(bands: T[]): T[] {
  if (bands.every((band) => normalizeEQBandColor(band.color) !== undefined)) return bands;
  const out = bands.slice();
  for (let i = 0; i < out.length; i++) {
    if (normalizeEQBandColor(out[i].color) !== undefined) continue;
    const others = out.filter((band, j) => j !== i && normalizeEQBandColor(band.color) !== undefined);
    out[i] = { ...out[i], color: nextFreeEQBandColor(others) };
  }
  return out;
}

function parseEQGraphicGains(value: unknown): number[] | null {
  if (!Array.isArray(value) || value.length !== EQ_GRAPHIC_BAND_COUNT) return null;
  const gains: number[] = [];
  for (const raw of value) {
    const parsed = Number(raw);
    if (!Number.isFinite(parsed)) return null;
    gains.push(clampEQGain(parsed));
  }
  return gains;
}

export function parseEQPresetData(value: unknown, createId: () => string): EQPreset {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Invalid preset file');
  }
  const raw = value as {
    version?: unknown;
    name?: unknown;
    preamp?: unknown;
    bands?: unknown;
    mode?: unknown;
    graphicGains?: unknown;
  };
  if (raw.version !== undefined && raw.version !== EQ_PRESET_VERSION) {
    throw new Error('Unsupported preset version');
  }
  if (typeof raw.name !== 'string' || raw.name.trim().length === 0 || !Array.isArray(raw.bands)) {
    throw new Error('Invalid preset file');
  }
  const preset: EQPreset = {
    id: createId(),
    name: raw.name.trim(),
    preamp: clampPreamp(coerceFiniteNumber(raw.preamp, 0)),
    bands: raw.bands
      .slice(0, EQ_MAX_BANDS)
      .map((band) =>
        createNormalizedEQBand(
          band && typeof band === 'object' && !Array.isArray(band) ? (band as RawEQBand) : {},
          createId()
        )
      ),
    isCustom: true,
  };
  const graphicGains = raw.mode === 'graphic' ? parseEQGraphicGains(raw.graphicGains) : null;
  if (!graphicGains) return preset;
  return {
    ...preset,
    mode: 'graphic',
    graphicGains,
  };
}

export function serializeEQPresetData(
  preset: Pick<EQPreset, 'name' | 'preamp' | 'bands' | 'mode' | 'graphicGains'>
): SerializedEQPresetData {
  const data: SerializedEQPresetData = {
    version: EQ_PRESET_VERSION,
    name: preset.name,
    preamp: clampPreamp(coerceFiniteNumber(preset.preamp, 0)),
    bands: preset.bands.map((b) => {
      const n = normalizeEQBand(b);
      return { type: n.type, frequency: n.frequency, gain: n.gain, Q: n.Q, enabled: n.enabled };
    }),
  };
  const graphicGains = preset.mode === 'graphic' ? parseEQGraphicGains(preset.graphicGains) : null;
  if (graphicGains) {
    data.mode = 'graphic';
    data.graphicGains = graphicGains;
  }
  return data;
}

// ---------------------------------------------------------------------------
// Response curve magnitude (Audio EQ Cookbook) — for the Skia response curve.
// ---------------------------------------------------------------------------

export interface EQFilterCoefficients {
  b0: number;
  b1: number;
  b2: number;
  a1: number;
  a2: number;
}

const MIN_FILTER_Q = 0.0001;

function normalizeCoefficientSet(
  b0: number,
  b1: number,
  b2: number,
  a0: number,
  a1: number,
  a2: number
): EQFilterCoefficients {
  'worklet';
  const invA0 = 1 / a0;
  return {
    b0: b0 * invA0,
    b1: b1 * invA0,
    b2: b2 * invA0,
    a1: a1 * invA0,
    a2: a2 * invA0,
  };
}

export function computeEQFilterCoefficients(band: EQBand, sampleRate: number): EQFilterCoefficients {
  'worklet';
  if (sampleRate <= 0) {
    return { b0: 1, b1: 0, b2: 0, a1: 0, a2: 0 };
  }

  const w0 = (2 * Math.PI * band.frequency) / sampleRate;
  const A = Math.pow(10, band.gain / 40);
  const sinW0 = Math.sin(w0);
  const cosW0 = Math.cos(w0);
  const alphaQ = sinW0 / (2 * Math.max(band.Q, MIN_FILTER_Q));
  const alphaQDb = sinW0 / (2 * Math.pow(10, band.Q / 20));

  let b0 = 1;
  let b1 = 0;
  let b2 = 0;
  let a0 = 1;
  let a1 = 0;
  let a2 = 0;

  switch (band.type) {
    case 'peaking':
      b0 = 1 + alphaQ * A;
      b1 = -2 * cosW0;
      b2 = 1 - alphaQ * A;
      a0 = 1 + alphaQ / A;
      a1 = -2 * cosW0;
      a2 = 1 - alphaQ / A;
      break;
    case 'lowshelf': {
      const sqrtA = Math.sqrt(A);
      b0 = A * (A + 1 - (A - 1) * cosW0 + 2 * sqrtA * alphaQ);
      b1 = 2 * A * (A - 1 - (A + 1) * cosW0);
      b2 = A * (A + 1 - (A - 1) * cosW0 - 2 * sqrtA * alphaQ);
      a0 = A + 1 + (A - 1) * cosW0 + 2 * sqrtA * alphaQ;
      a1 = -2 * (A - 1 + (A + 1) * cosW0);
      a2 = A + 1 + (A - 1) * cosW0 - 2 * sqrtA * alphaQ;
      break;
    }
    case 'highshelf': {
      const sqrtA = Math.sqrt(A);
      b0 = A * (A + 1 + (A - 1) * cosW0 + 2 * sqrtA * alphaQ);
      b1 = -2 * A * (A - 1 + (A + 1) * cosW0);
      b2 = A * (A + 1 + (A - 1) * cosW0 - 2 * sqrtA * alphaQ);
      a0 = A + 1 - (A - 1) * cosW0 + 2 * sqrtA * alphaQ;
      a1 = 2 * (A - 1 - (A + 1) * cosW0);
      a2 = A + 1 - (A - 1) * cosW0 - 2 * sqrtA * alphaQ;
      break;
    }
    case 'lowpass':
      b0 = (1 - cosW0) / 2;
      b1 = 1 - cosW0;
      b2 = (1 - cosW0) / 2;
      a0 = 1 + alphaQDb;
      a1 = -2 * cosW0;
      a2 = 1 - alphaQDb;
      break;
    case 'highpass':
      b0 = (1 + cosW0) / 2;
      b1 = -(1 + cosW0);
      b2 = (1 + cosW0) / 2;
      a0 = 1 + alphaQDb;
      a1 = -2 * cosW0;
      a2 = 1 - alphaQDb;
      break;
  }

  return normalizeCoefficientSet(b0, b1, b2, a0, a1, a2);
}

export function computeEQFilterMagnitude(band: EQBand, testFreq: number, sampleRate: number): number {
  'worklet';
  if (sampleRate <= 0) return 0;

  const w = (2 * Math.PI * testFreq) / sampleRate;
  const { b0, b1, b2, a1, a2 } = computeEQFilterCoefficients(band, sampleRate);
  const cosW = Math.cos(w);
  const sinW = Math.sin(w);
  const cos2W = Math.cos(2 * w);
  const sin2W = Math.sin(2 * w);

  const numReal = b0 + b1 * cosW + b2 * cos2W;
  const numImag = -b1 * sinW - b2 * sin2W;
  const denReal = 1 + a1 * cosW + a2 * cos2W;
  const denImag = -a1 * sinW - a2 * sin2W;

  const numMag = Math.sqrt(numReal * numReal + numImag * numImag);
  const denMag = Math.sqrt(denReal * denReal + denImag * denImag);

  return 20 * Math.log10(numMag / (denMag + 1e-20));
}

/** Sum of per-band magnitudes (dB) at a frequency, skipping disabled bands. */
export function computeCombinedEQMagnitude(
  bands: readonly EQBand[],
  testFreq: number,
  sampleRate: number
): number {
  let totalDb = 0;
  for (const band of bands) {
    if (band.enabled === false) continue;
    totalDb += computeEQFilterMagnitude(band, testFreq, sampleRate);
  }
  return totalDb;
}

// ---------------------------------------------------------------------------
// Native bridge encoding.
// ---------------------------------------------------------------------------

/** dB → linear amplitude (for the preamp gain pushed to native). */
export function dbToLinear(db: number): number {
  return Math.pow(10, db / 20);
}

/**
 * Flatten bands into the flat number[] the native EqBridge consumes:
 * 5 values per band — [typeOrdinal, frequency, gain, Q, enabled?1:0].
 * Disabled and pass-normalized bands are encoded as-is; Kotlin computes the
 * biquad coefficients at the actual stream sample rate.
 */
export function flattenBandsForNative(bands: readonly EQBand[]): number[] {
  const out: number[] = [];
  for (const band of bands) {
    const n = normalizeEQBand(band);
    out.push(
      EQ_BAND_TYPE_ORDINAL[n.type],
      n.frequency,
      n.gain,
      n.Q,
      n.enabled === false ? 0 : 1
    );
  }
  return out;
}

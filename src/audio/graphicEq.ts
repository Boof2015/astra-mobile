// Graphic EQ mode — a fixed 5-band beginner front-end over the parametric engine.
// Only gains are user-editable; frequencies/types/Q are locked and compiled into
// regular EQBands for the same native bridge (no DSP changes).

import type { EQBand, EQBandType } from '@/types/audio';
import { clampEQGain, computeCombinedEQMagnitude } from './eq';

// Matches the graph's display sample rate (eqGraphMath GRAPH_SAMPLE_RATE).
const DERIVE_SAMPLE_RATE = 48000;

export interface GraphicBandDef {
  key: string;
  label: string;
  frequency: number;
  type: EQBandType;
  Q: number;
}

// Same layout as DEFAULT_BAND_SEEDS (shelves at the extremes, peaking between).
// Peaking Q 0.8 instead of the parametric default 1.0: bands sit ~2 octaves apart
// and the wider skirts let adjacent boosted sliders sum smoothly instead of
// leaving a valley between them. Shelf Q 0.707 matches every built-in preset.
export const GRAPHIC_BANDS: readonly GraphicBandDef[] = [
  { key: 'bass', label: 'Bass', frequency: 60, type: 'lowshelf', Q: 0.707 },
  { key: 'low-mid', label: 'Low Mid', frequency: 250, type: 'peaking', Q: 0.8 },
  { key: 'mid', label: 'Mid', frequency: 1000, type: 'peaking', Q: 0.8 },
  { key: 'vocals', label: 'Vocals', frequency: 4000, type: 'peaking', Q: 0.8 },
  { key: 'treble', label: 'Treble', frequency: 12000, type: 'highshelf', Q: 0.707 },
];

export const GRAPHIC_BAND_COUNT = GRAPHIC_BANDS.length;

export function createFlatGraphicGains(): number[] {
  return GRAPHIC_BANDS.map(() => 0);
}

/** Compile slider gains into EQBands (stable ids — never mixed into the parametric set). */
export function buildGraphicBands(gains: readonly number[]): EQBand[] {
  return GRAPHIC_BANDS.map((def, i) => ({
    id: `graphic-${def.key}`,
    type: def.type,
    frequency: def.frequency,
    gain: clampEQGain(Number(gains[i]) || 0),
    Q: def.Q,
    enabled: true,
  }));
}

/**
 * Project a parametric band set onto the graphic sliders: the preset's combined
 * response sampled at each graphic band frequency (clamped ±12). An
 * approximation — lets mode-agnostic built-in presets apply in graphic mode.
 */
export function deriveGraphicGains(bands: readonly EQBand[]): number[] {
  return GRAPHIC_BANDS.map((def) =>
    clampEQGain(computeCombinedEQMagnitude(bands, def.frequency, DERIVE_SAMPLE_RATE))
  );
}

/**
 * Strict gains validation — exactly GRAPHIC_BAND_COUNT finite numbers or null.
 * The single guard for corrupt/wrong-length graphic data in settings or presets;
 * callers fall back to flat gains (store) or parametric bands (presets).
 */
export function parseGraphicGains(value: unknown): number[] | null {
  if (!Array.isArray(value) || value.length !== GRAPHIC_BAND_COUNT) return null;
  const gains: number[] = [];
  for (const raw of value) {
    if (typeof raw !== 'number' || !Number.isFinite(raw)) return null;
    gains.push(clampEQGain(raw));
  }
  return gains;
}

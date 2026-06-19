// Default bands + built-in presets — ported from desktop `src/renderer/stores/eqStore.ts`.
// Each band carries the mobile `enabled` flag (default on).

import type { EQBand, EQPreset } from '@/types/audio';

let idCounter = 0;
/** Monotonic, collision-free id for bands/presets (RN-safe, no crypto needed). */
export function genEqId(): string {
  idCounter += 1;
  return `eq-${Date.now().toString(36)}-${idCounter.toString(36)}`;
}

type BandSeed = Omit<EQBand, 'id' | 'enabled'> & { enabled?: boolean };

function mkBand(seed: BandSeed): EQBand {
  return {
    id: genEqId(),
    type: seed.type,
    frequency: seed.frequency,
    gain: seed.gain,
    Q: seed.Q,
    enabled: seed.enabled ?? true,
  };
}

// 5-band default (shelves at the extremes, 3 peaking in between). More bands can
// be added from the EQ screen up to EQ_MAX_BANDS.
export const DEFAULT_BAND_SEEDS: BandSeed[] = [
  { type: 'lowshelf', frequency: 60, gain: 0, Q: 0.707 },
  { type: 'peaking', frequency: 250, gain: 0, Q: 1.0 },
  { type: 'peaking', frequency: 1000, gain: 0, Q: 1.0 },
  { type: 'peaking', frequency: 4000, gain: 0, Q: 1.0 },
  { type: 'highshelf', frequency: 12000, gain: 0, Q: 0.707 },
];

/** Fresh default (flat) bands with new ids. */
export function createDefaultBands(): EQBand[] {
  return DEFAULT_BAND_SEEDS.map(mkBand);
}

interface PresetSeed {
  id: string;
  name: string;
  preamp: number;
  bands: BandSeed[];
}

const BUILT_IN_SEEDS: PresetSeed[] = [
  { id: 'flat', name: 'Flat', preamp: 0, bands: DEFAULT_BAND_SEEDS },
  {
    id: 'bass-boost',
    name: 'Bass Boost',
    preamp: -2,
    bands: [
      { type: 'lowshelf', frequency: 60, gain: 6, Q: 0.707 },
      { type: 'peaking', frequency: 150, gain: 4, Q: 1.0 },
      { type: 'peaking', frequency: 400, gain: 1, Q: 1.0 },
      { type: 'peaking', frequency: 1000, gain: 0, Q: 1.0 },
      { type: 'highshelf', frequency: 12000, gain: 0, Q: 0.707 },
    ],
  },
  {
    id: 'treble-boost',
    name: 'Treble Boost',
    preamp: -2,
    bands: [
      { type: 'lowshelf', frequency: 60, gain: 0, Q: 0.707 },
      { type: 'peaking', frequency: 1000, gain: 0, Q: 1.0 },
      { type: 'peaking', frequency: 4000, gain: 3, Q: 1.0 },
      { type: 'peaking', frequency: 8000, gain: 5, Q: 1.0 },
      { type: 'highshelf', frequency: 12000, gain: 6, Q: 0.707 },
    ],
  },
  {
    id: 'vocal',
    name: 'Vocal',
    preamp: -1,
    bands: [
      { type: 'lowshelf', frequency: 80, gain: -2, Q: 0.707 },
      { type: 'peaking', frequency: 250, gain: 1, Q: 1.0 },
      { type: 'peaking', frequency: 1500, gain: 4, Q: 1.2 },
      { type: 'peaking', frequency: 4000, gain: 3, Q: 1.0 },
      { type: 'highshelf', frequency: 12000, gain: 1, Q: 0.707 },
    ],
  },
  {
    id: 'loudness',
    name: 'Loudness',
    preamp: -3,
    bands: [
      { type: 'lowshelf', frequency: 60, gain: 5, Q: 0.707 },
      { type: 'peaking', frequency: 400, gain: 2, Q: 1.0 },
      { type: 'peaking', frequency: 1000, gain: -1, Q: 1.0 },
      { type: 'peaking', frequency: 4000, gain: 2, Q: 1.0 },
      { type: 'highshelf', frequency: 12000, gain: 5, Q: 0.707 },
    ],
  },
];

/** Built-in presets with fresh band ids (call once at store init). */
export function createBuiltInPresets(): EQPreset[] {
  return BUILT_IN_SEEDS.map((seed) => ({
    id: seed.id,
    name: seed.name,
    preamp: seed.preamp,
    bands: seed.bands.map(mkBand),
    isCustom: false,
  }));
}

export const FLAT_PRESET_ID = 'flat';

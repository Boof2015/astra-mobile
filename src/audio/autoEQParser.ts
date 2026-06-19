// AutoEQ ParametricEQ.txt parser — ported from desktop `src/renderer/utils/autoEQParser.ts`.

import type { EQBand, EQBandType, EQPreset } from '@/types/audio';
import { EQ_MAX_BANDS, clampEQFrequency, clampEQGain, clampEQQ, clampPreamp } from './eq';
import { genEqId } from './eqPresets';

const TYPE_MAP: Record<string, EQBandType> = {
  PK: 'peaking',
  LS: 'lowshelf',
  HS: 'highshelf',
};

/**
 * Parse an AutoEQ ParametricEQ.txt file into an EQPreset.
 *
 * Format:
 *   Preamp: -6.2 dB
 *   Filter 1: ON PK Fc 31 Hz Gain 4.5 dB Q 1.41
 *   Filter 2: ON LS Fc 105 Hz Gain -2.1 dB Q 0.71
 */
export function parseAutoEQ(content: string, filename?: string): EQPreset {
  const lines = content
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

  let preamp = 0;
  const bands: EQBand[] = [];

  for (const line of lines) {
    const preampMatch = line.match(/^Preamp:\s*([-\d.]+)\s*dB/i);
    if (preampMatch) {
      preamp = clampPreamp(parseFloat(preampMatch[1]));
      continue;
    }

    const filterMatch = line.match(
      /^Filter\s+\d+:\s*(ON|OFF)\s+(PK|LS|HS)\s+Fc\s+([\d.]+)\s*Hz\s+Gain\s+([-\d.]+)\s*dB\s+Q\s+([\d.]+)/i
    );
    if (filterMatch) {
      const [, onOff, typeCode, fc, gain, q] = filterMatch;
      if (onOff.toUpperCase() === 'OFF') continue;

      bands.push({
        id: genEqId(),
        type: TYPE_MAP[typeCode.toUpperCase()] || 'peaking',
        frequency: clampEQFrequency(parseFloat(fc)),
        gain: clampEQGain(parseFloat(gain)),
        Q: clampEQQ(parseFloat(q)),
        enabled: true,
      });
    }
  }

  bands.sort((a, b) => a.frequency - b.frequency);

  const name = filename
    ? filename.replace(/^.*[\\/]/, '').replace(/\.[^.]+$/, '')
    : 'Imported AutoEQ';

  return {
    id: genEqId(),
    name,
    preamp,
    bands: bands.slice(0, EQ_MAX_BANDS),
    isCustom: true,
  };
}

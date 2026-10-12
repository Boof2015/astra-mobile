import type { EQBand } from '../types/audio.ts';
import { clampEQFrequency, clampEQGain, clampEQQ, clampPreamp, isPassEQBandType } from '../audio/eq.ts';

export type EqDirection = 'up' | 'down' | 'left' | 'right';

/** Editing steps stay independent of sorted position: the caller updates by ID. */
export function stepEqBand(band: EQBand, direction: EqDirection): Partial<EQBand> {
  if (direction === 'left' || direction === 'right') return {
    frequency: Math.round(clampEQFrequency(band.frequency * 2 ** ((direction === 'right' ? 1 : -1) / 6))),
  };
  return isPassEQBandType(band.type) ? {} : { gain: clampEQGain(band.gain + (direction === 'up' ? .5 : -.5)) };
}
export function stepEqQ(value: number, direction: EqDirection) {
  return direction === 'left' || direction === 'right' ? clampEQQ(Number((value * (direction === 'right' ? 1.15 : 1 / 1.15)).toFixed(2))) : value;
}
export function stepEqPreamp(value: number, direction: EqDirection) {
  return direction === 'left' || direction === 'right' ? clampPreamp(value + (direction === 'right' ? .5 : -.5)) : value;
}
export function stepEqSlider(index: number, value: number, direction: EqDirection, count: number) {
  return direction === 'left' || direction === 'right'
    ? { index: Math.max(0, Math.min(count - 1, index + (direction === 'right' ? 1 : -1))), gain: value }
    : { index, gain: clampEQGain(value + (direction === 'up' ? .5 : -.5)) };
}

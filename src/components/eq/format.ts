// Shared EQ value formatting for the band strip + detail panel.

import { colors } from '@/theme';
import type { EQBandType } from '@/types/audio';

export function formatFreq(hz: number): string {
  if (hz >= 1000) {
    const k = hz / 1000;
    return `${Number.isInteger(k) ? k : k.toFixed(1)}k`;
  }
  return `${Math.round(hz)}`;
}

export function formatGain(db: number): string {
  if (Math.abs(db) < 0.05) return '0';
  return `${db > 0 ? '+' : ''}${db.toFixed(1)}`;
}

export function gainColor(db: number): string {
  if (db > 0.05) return colors.accentText;
  if (db < -0.05) return colors.warning;
  return colors.textTertiary;
}

export const BAND_TYPE_LABEL: Record<EQBandType, string> = {
  lowshelf: 'Low Shelf',
  peaking: 'Peaking',
  highshelf: 'High Shelf',
  highpass: 'High Pass',
  lowpass: 'Low Pass',
};

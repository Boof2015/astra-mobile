import { create } from 'zustand';
import type { EQBand } from '@/types/audio';

/**
 * EQ state — M0 stub. The biquad chain is implemented as a Media3 AudioProcessor
 * at M4; for now this just holds the band model (ported `EQBand`) so the EQ
 * screen and later DSP wiring share one shape.
 */
const DEFAULT_FREQUENCIES = [32, 64, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];

function makeDefaultBands(): EQBand[] {
  return DEFAULT_FREQUENCIES.map((frequency) => ({
    id: `band-${frequency}`,
    type: 'peaking',
    frequency,
    gain: 0,
    Q: 1.0,
  }));
}

interface EQStore {
  enabled: boolean;
  preamp: number; // dB
  bands: EQBand[];

  setEnabled: (enabled: boolean) => void;
  setPreamp: (preamp: number) => void;
  setBandGain: (id: string, gain: number) => void;
  reset: () => void;
}

export const useEQStore = create<EQStore>((set) => ({
  enabled: false,
  preamp: 0,
  bands: makeDefaultBands(),

  setEnabled: (enabled) => set({ enabled }),
  setPreamp: (preamp) => set({ preamp }),
  setBandGain: (id, gain) =>
    set((state) => ({
      bands: state.bands.map((b) => (b.id === id ? { ...b, gain } : b)),
    })),
  reset: () => set({ enabled: false, preamp: 0, bands: makeDefaultBands() }),
}));

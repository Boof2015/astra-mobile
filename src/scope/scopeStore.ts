import { create } from 'zustand';
import { DEFAULT_OSC_GAIN } from './oscilloscopeGain';

/**
 * Whether the visualizers should run. Set by useScopeLifecycle (foreground +
 * playing + not reduced-motion) and read by the scope components so they only
 * spin their frame loop when something is actually visible and moving.
 */
interface ScopeStore {
  active: boolean;
  setActive: (active: boolean) => void;
  /**
   * Per-track oscilloscope display gain. Set once per track by useNormalizationSync
   * (from the track's peak + the normalization gain) and read each frame by the
   * oscilloscope so the level is consistent across tracks but constant within one.
   */
  oscGain: number;
  setOscGain: (gain: number) => void;
}

export const useScopeStore = create<ScopeStore>((set) => ({
  active: false,
  setActive: (active) => set({ active }),
  oscGain: DEFAULT_OSC_GAIN,
  setOscGain: (oscGain) => set({ oscGain }),
}));

export const useScopeActive = (): boolean => useScopeStore((s) => s.active);

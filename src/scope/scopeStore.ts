import { create } from 'zustand';

/**
 * Whether the visualizers should run. Set by useScopeLifecycle (foreground +
 * playing + not reduced-motion) and read by the scope components so they only
 * spin their frame loop when something is actually visible and moving.
 */
interface ScopeStore {
  active: boolean;
  setActive: (active: boolean) => void;
}

export const useScopeStore = create<ScopeStore>((set) => ({
  active: false,
  setActive: (active) => set({ active }),
}));

export const useScopeActive = (): boolean => useScopeStore((s) => s.active);

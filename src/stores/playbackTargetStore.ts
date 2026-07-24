import { create } from 'zustand';
import { getNativeSetting, setNativeSetting } from '@/db/nativeSettings';

const PLAYBACK_TARGET_KEY = 'playback_target';

export type PlaybackTarget = 'phone' | 'desktop';

function parsePlaybackTarget(value: string | null): PlaybackTarget {
  return value === 'desktop' ? 'desktop' : 'phone';
}

interface PlaybackTargetStore {
  target: PlaybackTarget;
  loaded: boolean;
  load: () => Promise<void>;
  setTarget: (target: PlaybackTarget) => Promise<void>;
}

export const usePlaybackTargetStore = create<PlaybackTargetStore>((set, get) => ({
  target: 'phone',
  loaded: false,

  load: async () => {
    if (get().loaded) return;
    const stored = await getNativeSetting(PLAYBACK_TARGET_KEY);
    set({ target: parsePlaybackTarget(stored), loaded: true });
  },

  setTarget: async (target) => {
    if (get().target === target && get().loaded) return;
    set({ target, loaded: true });
    await setNativeSetting(PLAYBACK_TARGET_KEY, target);
  },
}));

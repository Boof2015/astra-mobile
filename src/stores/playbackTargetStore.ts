import { create } from 'zustand';
import { openLibraryDb } from '@/db/database';
import { getSetting, setSetting } from '@/db/queries';

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
    const db = await openLibraryDb();
    const stored = await getSetting(db, PLAYBACK_TARGET_KEY);
    set({ target: parsePlaybackTarget(stored), loaded: true });
  },

  setTarget: async (target) => {
    if (get().target === target && get().loaded) return;
    set({ target, loaded: true });
    const db = await openLibraryDb();
    await setSetting(db, PLAYBACK_TARGET_KEY, target);
  },
}));

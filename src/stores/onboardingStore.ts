import { create } from 'zustand';
import { AstraLibraryData } from '../../modules/astra-library-scanner';
import { getNativeSetting, setNativeSetting } from '@/db/nativeSettings';

/**
 * First-run wizard gate. SQLite (settings table) is the source of truth, mirrored
 * in memory like the other pref stores. The wizard shows once on a fresh install
 * and never again once `onboardingComplete` is persisted.
 */
const ONBOARDING_COMPLETE_KEY = 'onboarding_complete';

interface OnboardingStore {
  onboardingComplete: boolean;
  loaded: boolean;
  /**
   * In memory only: the wizard was re-armed from Settings › Troubleshooting while
   * the app is running. Back on the first page then finishes the replay instead
   * of reaching the Troubleshooting screen still mounted underneath.
   */
  replaying: boolean;
  load: () => Promise<void>;
  markComplete: () => Promise<void>;
  /** Re-arm the wizard (Settings › Troubleshooting › Replay onboarding). */
  reset: () => Promise<void>;
}

export const useOnboardingStore = create<OnboardingStore>((set, get) => ({
  onboardingComplete: false,
  loaded: false,
  replaying: false,

  load: async () => {
    if (get().loaded) return;
    const value = await getNativeSetting(ONBOARDING_COMPLETE_KEY);
    if (value !== null) {
      set({ onboardingComplete: value === 'true', loaded: true });
      return;
    }
    // Flag never set: an install that already has library folders predates this
    // wizard — treat it as onboarded (and persist) so the wizard never ambushes
    // an upgrading user. A genuinely fresh install has no folders → show it.
    const folders = await AstraLibraryData.listFolders();
    const complete = folders.length > 0;
    if (complete) await setNativeSetting(ONBOARDING_COMPLETE_KEY, 'true');
    set({ onboardingComplete: complete, loaded: true });
  },

  markComplete: async () => {
    set({ onboardingComplete: true, replaying: false });
    await setNativeSetting(ONBOARDING_COMPLETE_KEY, 'true');
  },

  reset: async () => {
    set({ onboardingComplete: false, replaying: true });
    await setNativeSetting(ONBOARDING_COMPLETE_KEY, 'false');
  },
}));

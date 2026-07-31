import { create } from 'zustand';
import { AstraLibraryData } from '../../modules/astra-library-scanner';
import { useSettingsStore } from './settingsStore';
import type {
  ListeningStatsCategory,
  ListeningStatsDashboard,
  ListeningStatsRange,
  ListeningStatsRankingMetric,
} from '@/types/listeningStats';

interface ListeningStatsStore {
  range: ListeningStatsRange;
  rankingMetric: ListeningStatsRankingMetric;
  category: ListeningStatsCategory;
  dashboard: ListeningStatsDashboard | null;
  homePreview: ListeningStatsDashboard | null;
  loading: boolean;
  refreshing: boolean;
  error: string | null;
  setRange: (range: ListeningStatsRange) => void;
  setRankingMetric: (metric: ListeningStatsRankingMetric) => void;
  setCategory: (category: ListeningStatsCategory) => void;
  /**
   * `silent` refreshes leave `refreshing` alone. Background triggers must use it:
   * the screen reloads on a timer and on every listening checkpoint (~10s apart
   * during playback), and `refreshing` drives the pull-to-refresh spinner, so
   * non-silent background loads made the spinner flash on its own.
   */
  loadDashboard: (options?: { silent?: boolean }) => Promise<void>;
  loadHomePreview: () => Promise<void>;
}

let dashboardRequest = 0;
let homeRequest = 0;

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message ? error.message : 'Listening Stats could not load.';
}

async function queryDashboard(
  range: ListeningStatsRange,
  rankingMetric: ListeningStatsRankingMetric,
): Promise<ListeningStatsDashboard> {
  await AstraLibraryData.initialize();
  return AstraLibraryData.getListeningStatsDashboard<ListeningStatsDashboard>({
    range,
    rankingMetric,
    artistGroupingMode: useSettingsStore.getState().artistGroupingMode,
  });
}

export const useListeningStatsStore = create<ListeningStatsStore>((set, get) => ({
  range: '30d',
  rankingMetric: 'plays',
  category: 'tracks',
  dashboard: null,
  homePreview: null,
  loading: false,
  refreshing: false,
  error: null,

  // Switching range or metric reloads silently: the segmented control and the
  // chart's own reveal already show that something changed, and driving
  // `refreshing` here would flash the pull-to-refresh spinner on every tap.
  setRange: (range) => {
    if (get().range === range) return;
    set({ range });
    void get().loadDashboard({ silent: true });
  },

  setRankingMetric: (rankingMetric) => {
    if (get().rankingMetric === rankingMetric) return;
    set({ rankingMetric });
    void get().loadDashboard({ silent: true });
  },

  setCategory: (category) => set({ category }),

  loadDashboard: async (options) => {
    const request = ++dashboardRequest;
    const silent = options?.silent === true;
    set((state) => ({
      loading: state.dashboard == null,
      refreshing: silent ? state.refreshing : state.dashboard != null,
      error: null,
    }));
    try {
      const { range, rankingMetric } = get();
      const dashboard = await queryDashboard(range, rankingMetric);
      if (request !== dashboardRequest) return;
      set({ dashboard, loading: false, refreshing: false, error: null });
    } catch (error) {
      if (request !== dashboardRequest) return;
      set({ loading: false, refreshing: false, error: errorMessage(error) });
    }
  },

  loadHomePreview: async () => {
    const request = ++homeRequest;
    try {
      const homePreview = await queryDashboard('7d', 'plays');
      if (request === homeRequest) set({ homePreview });
    } catch {
      // Home remains quiet on transient stats failures; the full screen has retry UI.
    }
  },
}));

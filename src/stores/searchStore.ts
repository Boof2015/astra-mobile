import { create } from 'zustand';

interface SearchStore {
  isQuickSearchOpen: boolean;
  initialQuery: string;
  openVersion: number;
  openQuickSearch: (initialQuery?: string) => void;
  closeQuickSearch: () => void;
}

export const useSearchStore = create<SearchStore>((set) => ({
  isQuickSearchOpen: false,
  initialQuery: '',
  openVersion: 0,
  openQuickSearch: (initialQuery = '') =>
    set((state) => ({
      isQuickSearchOpen: true,
      initialQuery,
      openVersion: state.openVersion + 1,
    })),
  closeQuickSearch: () => set({ isQuickSearchOpen: false }),
}));

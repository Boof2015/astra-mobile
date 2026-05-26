import { create } from 'zustand';
import type { Album, Artist, DbTrack } from '@/types/library';

/**
 * Library state — minimal M0 stub. Real on-device scanning + SQLite (op-sqlite)
 * land at M1; the shapes here mirror desktop `libraryStore` so that work slots in.
 */
type ViewMode = 'tracks' | 'albums' | 'artists' | 'folders';

interface LibraryStore {
  tracks: DbTrack[];
  albums: Album[];
  artists: Artist[];
  totalTrackCount: number;
  viewMode: ViewMode;
  isScanning: boolean;

  setViewMode: (mode: ViewMode) => void;
}

export const useLibraryStore = create<LibraryStore>((set) => ({
  tracks: [],
  albums: [],
  artists: [],
  totalTrackCount: 0,
  viewMode: 'albums',
  isScanning: false,

  setViewMode: (viewMode) => set({ viewMode }),
}));

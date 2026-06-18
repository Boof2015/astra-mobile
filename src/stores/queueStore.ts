import { create } from 'zustand';
import TrackPlayer, { type Track as RntpTrack } from 'react-native-track-player';

/**
 * Live mirror of RNTP's native queue for the queue tray. Playback actions keep
 * this in sync so opening the tray can render from JS immediately instead of
 * marshaling a very large native queue across the bridge on the cold path.
 */
interface QueueStore {
  tracks: RntpTrack[];
  activeIndex: number;
  hasSnapshot: boolean;
  refreshFromNative: () => Promise<void>;
  refreshActiveIndex: () => Promise<void>;
  setSnapshot: (tracks: RntpTrack[], activeIndex?: number) => void;
  setActiveIndex: (activeIndex: number) => void;
  insertTrack: (track: RntpTrack, index?: number) => void;
  replaceUpcoming: (upcoming: RntpTrack[]) => void;
  moveItem: (fromIndex: number, toIndex: number) => void;
  removeIndices: (indices: number[]) => void;
}

function normalizeActiveIndex(activeIndex: number | undefined, trackCount: number): number {
  if (activeIndex == null || activeIndex < 0 || activeIndex >= trackCount) return -1;
  return activeIndex;
}

function boundedInsertIndex(index: number | undefined, length: number): number {
  if (index == null) return length;
  return Math.max(0, Math.min(length, index));
}

export const useQueueStore = create<QueueStore>((set) => ({
  tracks: [],
  activeIndex: -1,
  hasSnapshot: false,
  refreshFromNative: async () => {
    const [tracks, activeIndex] = await Promise.all([
      TrackPlayer.getQueue(),
      TrackPlayer.getActiveTrackIndex(),
    ]);
    set({
      tracks,
      activeIndex: normalizeActiveIndex(activeIndex, tracks.length),
      hasSnapshot: true,
    });
  },
  refreshActiveIndex: async () => {
    const activeIndex = await TrackPlayer.getActiveTrackIndex();
    set((s) => ({ activeIndex: normalizeActiveIndex(activeIndex, s.tracks.length) }));
  },
  setSnapshot: (tracks, activeIndex = 0) =>
    set({
      tracks,
      activeIndex: normalizeActiveIndex(activeIndex, tracks.length),
      hasSnapshot: true,
    }),
  setActiveIndex: (activeIndex) =>
    set((s) => ({ activeIndex: normalizeActiveIndex(activeIndex, s.tracks.length) })),
  insertTrack: (track, index) =>
    set((s) => {
      const insertAt = boundedInsertIndex(index, s.tracks.length);
      const tracks = [...s.tracks];
      tracks.splice(insertAt, 0, track);
      const activeIndex = s.activeIndex >= insertAt ? s.activeIndex + 1 : s.activeIndex;
      return { tracks, activeIndex, hasSnapshot: true };
    }),
  replaceUpcoming: (upcoming) =>
    set((s) => {
      const prefixEnd = s.activeIndex >= 0 ? s.activeIndex + 1 : 0;
      return {
        tracks: [...s.tracks.slice(0, prefixEnd), ...upcoming],
        hasSnapshot: true,
      };
    }),
  moveItem: (fromIndex, toIndex) =>
    set((s) => {
      if (fromIndex === toIndex || fromIndex < 0 || fromIndex >= s.tracks.length) return s;

      const tracks = [...s.tracks];
      const [moved] = tracks.splice(fromIndex, 1);
      const insertAt = boundedInsertIndex(toIndex, tracks.length);
      tracks.splice(insertAt, 0, moved);

      let activeIndex = s.activeIndex;
      if (activeIndex === fromIndex) {
        activeIndex = insertAt;
      } else if (fromIndex < activeIndex && insertAt >= activeIndex) {
        activeIndex -= 1;
      } else if (fromIndex > activeIndex && insertAt <= activeIndex) {
        activeIndex += 1;
      }

      return { tracks, activeIndex, hasSnapshot: true };
    }),
  removeIndices: (indices) =>
    set((s) => {
      if (indices.length === 0 || s.tracks.length === 0) return s;

      const removeSet = new Set(
        indices.filter((index) => index >= 0 && index < s.tracks.length)
      );
      if (removeSet.size === 0) return s;

      const tracks = s.tracks.filter((_, index) => !removeSet.has(index));
      let activeIndex = s.activeIndex;
      if (activeIndex >= 0) {
        if (removeSet.has(activeIndex)) {
          activeIndex = tracks.length > 0 ? Math.min(activeIndex, tracks.length - 1) : -1;
        } else {
          let removedBeforeActive = 0;
          removeSet.forEach((index) => {
            if (index < activeIndex) removedBeforeActive += 1;
          });
          activeIndex -= removedBeforeActive;
        }
      }

      return {
        tracks,
        activeIndex: normalizeActiveIndex(activeIndex, tracks.length),
        hasSnapshot: true,
      };
    }),
}));

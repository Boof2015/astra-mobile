import { useEffect } from 'react';
import { Event, useTrackPlayerEvents, type Track as RntpTrack } from 'react-native-track-player';
import { useQueueStore } from '@/stores/queueStore';
import { nativeIndexToAbsolute } from '@/audio/queueLoader';

export interface QueueSnapshot {
  tracks: RntpTrack[];
  activeIndex: number;
  hasSnapshot: boolean;
  refresh: () => Promise<void>;
}

/**
 * Live view of the JS queue mirror. Opening the tray only falls back to RNTP's
 * full native queue read when no playback action has populated the mirror yet.
 */
export function useQueue(active: boolean): QueueSnapshot {
  const tracks = useQueueStore((s) => s.tracks);
  const activeIndex = useQueueStore((s) => s.activeIndex);
  const hasSnapshot = useQueueStore((s) => s.hasSnapshot);
  const refresh = useQueueStore((s) => s.refreshFromNative);
  const refreshActiveIndex = useQueueStore((s) => s.refreshActiveIndex);
  const setActiveIndex = useQueueStore((s) => s.setActiveIndex);

  useEffect(() => {
    if (!active) return;
    if (hasSnapshot) void refreshActiveIndex();
    else void refresh();
  }, [active, hasSnapshot, refresh, refreshActiveIndex]);

  useTrackPlayerEvents([Event.PlaybackActiveTrackChanged], (event) => {
    if (!active) return;
    if (hasSnapshot) {
      // Event indices are native — shifted while a chunked load is prepending the head.
      setActiveIndex(event.index != null ? nativeIndexToAbsolute(event.index) : -1);
    } else {
      void refresh();
    }
  });

  return { tracks, activeIndex, hasSnapshot, refresh };
}

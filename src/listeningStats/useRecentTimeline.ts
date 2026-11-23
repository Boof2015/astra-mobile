import { useCallback, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { AstraLibraryData, type RecentTimelineCursor } from '../../modules/astra-library-scanner';
import type { RecentTrackSummary } from '@/types/library';
import { subscribeToListeningHistory } from './events';
import { localDayStart, timelineRows, type TimelineRow } from './recentTimeline';
import { subscribeToLocalDayChanges } from './localDayChanges';

const PAGE_SIZE = 50;

export function useRecentTimeline() {
  const [rows, setRows] = useState<TimelineRow<RecentTrackSummary>[]>([]);
  const [generation, setGeneration] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const cursor = useRef<RecentTimelineCursor | null>(null);
  const request = useRef(0);
  const busy = useRef(false);
  const atTop = useRef(true);
  const pendingHead = useRef(false);
  const focused = useRef(false);
  const failedAppend = useRef(false);

  const read = useCallback(async (append: boolean) => {
    if (!focused.current || (append && (busy.current || !cursor.current))) return;
    const after = append ? cursor.current : null;
    const token = ++request.current;
    busy.current = true;
    setLoading(true);
    setError(false);
    try {
      const page = await AstraLibraryData.getRecentTimelinePage(after, PAGE_SIZE);
      if (request.current !== token) return;
      // A different generation means native already restarted the page after a clear.
      const today = localDayStart(Date.now());
      setRows(prior => timelineRows(page.items, today, after?.generation === page.generation ? prior : []));
      setGeneration(page.generation);
      cursor.current = page.nextCursor;
      setHasMore(page.nextCursor != null);
    } catch {
      if (request.current === token) {
        failedAppend.current = append;
        setError(true);
      }
    } finally {
      if (request.current === token) {
        busy.current = false;
        setLoading(false);
      }
    }
  }, []);

  const refreshHead = useCallback(() => {
    pendingHead.current = true;
    if (atTop.current && AppState.currentState === 'active') {
      pendingHead.current = false;
      void read(false);
    }
  }, [read]);

  const setTopVisible = useCallback((visible: boolean) => {
    atTop.current = visible;
    if (visible && pendingHead.current) refreshHead();
  }, [refreshHead]);

  useFocusEffect(useCallback(() => {
    focused.current = true;
    pendingHead.current = false;
    void read(false);
    const stopClock = subscribeToLocalDayChanges(() => {
      cursor.current = null;
      setRows([]);
      setHasMore(false);
      void read(false);
    }, refreshHead);
    const catalog = AstraLibraryData.addListener('onCatalogChanged', () => void read(false));
    const unsubscribe = subscribeToListeningHistory(({ qualifiedNow, cleared }) => {
      if (cleared) void read(false);
      else if (qualifiedNow) refreshHead();
    });
    return () => {
      focused.current = false;
      request.current++;
      stopClock();
      unsubscribe();
      catalog.remove();
    };
  }, [read, refreshHead]));

  return {
    rows, generation, loading, error, hasMore, setTopVisible,
    loadMore: () => void read(true),
    retry: () => void read(failedAppend.current),
  };
}

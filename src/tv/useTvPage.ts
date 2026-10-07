import { useCallback, useEffect, useRef, useState } from 'react';
import { AstraLibraryData } from '../../modules/astra-library-scanner';
import { readTvWindow, type TvPage } from './pageWindow';
export type { TvPage } from './pageWindow';

/** Independent TV paging/sorting: browsing TV never rewrites phone list prefs.
 * Stale async responses cannot replace a newly selected collection. */
export function useTvPage<T, S = never>(read: (cursor: string | null) => Promise<TvPage<T, S>>, keyOf: (item: T) => string, revision?: unknown,
  readBefore?: (cursor: string) => Promise<TvPage<T, S>>) {
  const [page, setPage] = useState<TvPage<T, S>>({ items: [], nextCursor: null, totalCount: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const generation = useRef(0);
  const busy = useRef(false);
  const loadedCount = useRef(0);
  const lastRevision = useRef(revision);
  const restoreWindow = useRef<(() => Promise<TvPage<T, S>>) | null>(null);
  const replaceWindow = useCallback((window: TvPage<T, S>, restore: () => Promise<TvPage<T, S>>) => {
    generation.current++; busy.current = false;
    restoreWindow.current = restore;
    loadedCount.current = window.items.length;
    setPage(window); setLoading(false); setError(null);
  }, []);
  const readPage = useCallback(async (cursor: string | null, replace: boolean) => {
    if (!replace && busy.current) return;
    const version = replace ? ++generation.current : generation.current;
    busy.current = true; setLoading(true); setError(null);
    try {
      const window = await readTvWindow(value => value === null && restoreWindow.current ? restoreWindow.current() : read(value), cursor, loadedCount.current, () => version === generation.current);
      if (!window) return;
      const result = window.page;
      replace = window.replace;
      loadedCount.current = replace ? result.items.length : loadedCount.current + result.items.length;
      setPage(previous => {
        if (replace) return result;
        const seen = new Set(previous.items.map(keyOf));
        return { ...result, previousCursor: previous.previousCursor, items: [...previous.items, ...result.items.filter(item => !seen.has(keyOf(item)))] };
      });
    } catch (reason) {
      if (version === generation.current) setError(reason instanceof Error ? reason.message : 'Could not load the library.');
    } finally {
      if (version === generation.current) { busy.current = false; setLoading(false); }
    }
  }, [read, keyOf]);
  useEffect(() => {
    let cancelled = false;
    const invalidate = () => { generation.current++; };
    queueMicrotask(() => {
      if (cancelled) return;
      restoreWindow.current = null;
      loadedCount.current = 0;
      setPage({ items: [], nextCursor: null, totalCount: 0 });
      void readPage(null, true);
    });
    const subscription = AstraLibraryData.addListener('onCatalogChanged', () => void readPage(null, true));
    const images = AstraLibraryData.addListener('onArtistImagesChanged', () => void readPage(null, true));
    return () => { cancelled = true; invalidate(); subscription.remove(); images.remove(); };
  }, [readPage]);
  useEffect(() => {
    if (lastRevision.current === revision) return;
    lastRevision.current = revision;
    void readPage(null, true);
  }, [revision, readPage]);
  const loadMore = useCallback(() => { if (page.nextCursor && !error) void readPage(page.nextCursor, false); }, [page.nextCursor, readPage, error]);
  const loadPrevious = useCallback(async () => {
    if (!readBefore || !page.previousCursor || busy.current || error) return;
    const version = generation.current;
    busy.current = true; setLoading(true);
    try {
      const result = await readBefore(page.previousCursor);
      if (version !== generation.current) return;
      if (result.error === 'STALE_REVISION') { void readPage(null, true); return; }
      if (result.error) throw new Error(result.error);
      loadedCount.current += result.items.length;
      setPage(previous => {
        const seen = new Set(previous.items.map(keyOf));
        return { ...previous, previousCursor: result.previousCursor, items: [...result.items.filter(item => !seen.has(keyOf(item))), ...previous.items] };
      });
    } catch (reason) {
      if (version === generation.current) setError(reason instanceof Error ? reason.message : 'Could not load the library.');
    } finally {
      if (version === generation.current) { busy.current = false; setLoading(false); }
    }
  }, [readBefore, page.previousCursor, error, keyOf, readPage]);
  const retry = useCallback(() => void readPage(null, true), [readPage]);
  return { ...page, loading, error, loadMore, loadPrevious, replaceWindow, retry };
}

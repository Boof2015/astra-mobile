import { useCallback, useEffect, useRef, useState } from 'react';
import { AstraLibraryData } from '../../modules/astra-library-scanner';

export type TvPage<T, S = never> = { items: T[]; nextCursor: string | null; totalCount: number; summary?: S | null; error?: string };

/** Independent TV paging/sorting: browsing TV never rewrites phone list prefs.
 * Stale async responses cannot replace a newly selected collection. */
export function useTvPage<T, S = never>(read: (cursor: string | null) => Promise<TvPage<T, S>>, keyOf: (item: T) => string) {
  const [page, setPage] = useState<TvPage<T, S>>({ items: [], nextCursor: null, totalCount: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const generation = useRef(0);
  const busy = useRef(false);
  const readPage = useCallback(async (cursor: string | null, replace: boolean) => {
    if (!replace && busy.current) return;
    const version = replace ? ++generation.current : generation.current;
    busy.current = true; setLoading(true); setError(null);
    try {
      let result = await read(cursor);
      if (result.error === 'STALE_REVISION') { result = await read(null); replace = true; }
      if (version !== generation.current) return;
      if (result.error) throw new Error('The library changed. Please try again.');
      setPage(previous => {
        if (replace) return result;
        const seen = new Set(previous.items.map(keyOf));
        return { ...result, items: [...previous.items, ...result.items.filter(item => !seen.has(keyOf(item)))] };
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
      setPage({ items: [], nextCursor: null, totalCount: 0 });
      void readPage(null, true);
    });
    const subscription = AstraLibraryData.addListener('onCatalogChanged', () => void readPage(null, true));
    return () => { cancelled = true; invalidate(); subscription.remove(); };
  }, [readPage]);
  const loadMore = useCallback(() => { if (page.nextCursor) void readPage(page.nextCursor, false); }, [page.nextCursor, readPage]);
  const retry = useCallback(() => void readPage(null, true), [readPage]);
  return { ...page, loading, error, loadMore, retry };
}

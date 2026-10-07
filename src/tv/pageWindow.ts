export type TvPage<T, S = never> = { items: T[]; nextCursor: string | null; previousCursor?: string | null; totalCount: number; summary?: S | null; error?: string };

/** Refresh enough pages to retain the visible window; never publish half of a
 * refreshed collection. A revision change during pagination restarts once. */
export async function readTvWindow<T, S>(
  read: (cursor: string | null) => Promise<TvPage<T, S>>, cursor: string | null,
  minimumCount: number, current: () => boolean,
): Promise<{ page: TvPage<T, S>; replace: boolean } | null> {
  let start = cursor;
  for (let attempt = 0; attempt < 2; attempt++) {
    let page = await read(start);
    const visited = new Set<string>();
    while (current() && !page.error && start === null && page.nextCursor && page.items.length < minimumCount) {
      if (visited.has(page.nextCursor)) throw new Error('Could not continue loading this collection.');
      visited.add(page.nextCursor);
      const next = await read(page.nextCursor);
      page = { ...next, previousCursor: page.previousCursor, items: [...page.items, ...next.items] };
    }
    if (!current()) return null;
    if (!page.error) return { page, replace: start === null };
    if (page.error !== 'STALE_REVISION') throw new Error(page.error);
    start = null;
  }
  throw new Error('The library changed. Please try again.');
}

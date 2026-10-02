/** A complete, revision-consistent window around an alphabetical destination. */
export interface SectionJumpPage<T> {
  items: T[];
  nextCursor: string | null;
  previousCursor: string | null;
  totalCount: number;
  catalogRevision: string;
  error?: string;
}

export interface SectionJumpWindow<T> {
  items: T[];
  nextCursor: string | null;
  previousCursor: string | null;
  totalCount: number;
  anchorIndex: number;
}

export async function prepareSectionJump<T>(
  readForward: () => Promise<SectionJumpPage<T>>,
  readBackward: () => Promise<SectionJumpPage<T>>,
  keyOf: (item: T) => string,
): Promise<SectionJumpWindow<T> | null> {
  // Wait for both reads even on rejection: the coordinator must not start a new
  // pair while the previous pair's surviving native read is still running.
  const results = await Promise.allSettled([
    Promise.resolve().then(readForward),
    Promise.resolve().then(readBackward),
  ]);
  if (results[0].status !== 'fulfilled' || results[1].status !== 'fulfilled') return null;
  const page = results[0].value;
  const before = results[1].value;
  if (
    !page || !before || page.error || before.error ||
    !Array.isArray(page.items) || !Array.isArray(before.items) ||
    page.items.length === 0 ||
    typeof page.catalogRevision !== 'string' || !page.catalogRevision ||
    page.catalogRevision !== before.catalogRevision ||
    !Number.isInteger(page.totalCount) || page.totalCount !== before.totalCount ||
    page.totalCount < page.items.length + before.items.length ||
    !(page.nextCursor === null || typeof page.nextCursor === 'string') ||
    !(before.previousCursor === null || typeof before.previousCursor === 'string') ||
    (before.items.length === 0 && before.previousCursor !== null)
  ) return null;
  const items = [...before.items, ...page.items];
  // Overlap is a broken boundary, not something to silently deduplicate: that
  // would change the initial index and could turn the destination into row 0.
  if (new Set(items.map(keyOf)).size !== items.length) return null;
  return {
    items,
    nextCursor: page.nextCursor,
    previousCursor: before.previousCursor,
    totalCount: page.totalCount,
    anchorIndex: before.items.length,
  };
}

interface JumpRequest<T> {
  key: string;
  prepare: () => Promise<T | null>;
  /** Commit synchronously and return the revision of the list being mounted. */
  apply: (destination: T) => number | null;
  onUnavailable?: () => void;
}

/** One native read pair, one latest intention, and four reusable destinations. */
export function createSectionJumpCoordinator<T>() {
  const cache = new Map<string, T>();
  let epoch = 0;
  let pending: (JumpRequest<T> & { resolve: (applied: boolean) => void }) | null = null;
  let reading = false;
  let mounting: number | null = null;

  const pump = () => {
    const request = pending;
    if (!request) return;
    const destination = cache.get(request.key);
    if (destination !== undefined) {
      // A requested destination stays hot even while waiting for a mount; an
      // obsolete read finishing meanwhile must not evict it.
      cache.delete(request.key);
      cache.set(request.key, destination);
      if (mounting !== null) return;
      pending = null;
      mounting = request.apply(destination);
      request.resolve(mounting !== null);
      return;
    }
    if (reading) return;
    reading = true;
    const readEpoch = epoch;
    void (async () => {
      let prepared: T | null = null;
      try {
        prepared = await request.prepare();
      } catch {
        // A failed destination leaves the visible window intact and is retryable.
      }
      reading = false;
      if (readEpoch === epoch) {
        if (prepared !== null) {
          cache.delete(request.key);
          cache.set(request.key, prepared);
          if (cache.size > 4) cache.delete(cache.keys().next().value!);
        } else if (pending?.key === request.key) {
          const failed = pending;
          pending = null;
          failed.resolve(false);
          failed.onUnavailable?.();
        }
      }
      pump();
    })();
  };

  return {
    request(request: JumpRequest<T>): Promise<boolean> {
      pending?.resolve(false);
      return new Promise((resolve) => {
        pending = { ...request, resolve };
        pump();
      });
    },
    mounting(revision: number) {
      mounting = revision;
    },
    ready(revision: number) {
      if (mounting !== revision) return;
      mounting = null;
      pump();
    },
    cancel() {
      epoch += 1;
      pending?.resolve(false);
      pending = null;
      mounting = null;
      cache.clear();
      // Do not clear `reading`: native promises cannot be cancelled. Their
      // results are invalidated, but they still occupy the single read slot.
    },
  };
}

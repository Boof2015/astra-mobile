import type { TvPage } from './pageWindow';

export type ReorderState<T> = TvPage<T> & {
  focusedKey: string; grabbed: boolean; working: boolean; finishing: boolean;
};

/** Apply adjacent native writes in input order. A row moves on acknowledgement,
 * so a failed write cannot leave an apparently saved, purely visual order.
 * Pagination shares the same worker and cannot race a boundary-crossing move. */
export function createPlaylistReorder<T>({ initial, focusedKey, keyOf, read, write, changed, failed }: {
  initial: TvPage<T>; focusedKey: string; keyOf: (item: T) => string;
  read: (cursor: string) => Promise<TvPage<T>>;
  write: (key: string, direction: -1 | 1) => Promise<void>;
  changed: (state: ReorderState<T>) => void; failed: (reason: unknown) => void;
}) {
  let state: ReorderState<T> = { ...initial, items: [...initial.items], focusedKey, grabbed: false, working: false, finishing: false };
  let alive = true;
  let worker: Promise<void> | null = null;
  let more = false;
  const moves: { key: string; direction: -1 | 1 }[] = [];
  const publish = (patch: Partial<ReorderState<T>>) => {
    state = { ...state, ...patch };
    if (alive) changed(state);
  };
  const append = async () => {
    const cursor = state.nextCursor;
    if (!cursor) return;
    const page = await read(cursor);
    if (!alive) return;
    const seen = new Set(state.items.map(keyOf));
    if (page.error || page.totalCount !== state.totalCount || page.items.some(item => seen.has(keyOf(item))) || page.nextCursor === cursor) {
      throw new Error('This playlist changed. Finish reordering to reload it.');
    }
    publish({ items: [...state.items, ...page.items], nextCursor: page.nextCursor });
  };
  const pump = () => {
    if (worker || !alive) return;
    publish({ working: true });
    // Begin on a microtask so worker is installed even when there is no await.
    worker = Promise.resolve().then(async () => {
      try {
        while (alive && (moves.length || more)) {
          const move = moves.shift();
          if (!move) { more = false; await append(); continue; }
          let index = state.items.findIndex(item => keyOf(item) === move.key);
          if (index < 0) continue;
          if (move.direction === 1 && index === state.items.length - 1 && state.nextCursor) await append();
          if (!alive) break;
          index = state.items.findIndex(item => keyOf(item) === move.key);
          const target = index + move.direction;
          if (index < 0 || target < 0 || target >= state.items.length) continue;
          await write(move.key, move.direction);
          if (!alive) break;
          const items = [...state.items];
          [items[index], items[target]] = [items[target], items[index]];
          publish({ items });
        }
      } catch (reason) {
        moves.length = 0; more = false;
        publish({ grabbed: false });
        if (alive) failed(reason);
      } finally {
        worker = null;
        publish({ working: false });
      }
    });
  };
  return {
    snapshot: () => state,
    focus(key: string) {
      if (!state.grabbed && !state.finishing && state.focusedKey !== key) publish({ focusedKey: key });
    },
    toggleGrab() { if (!state.finishing) publish({ grabbed: !state.grabbed }); },
    drop() { publish({ grabbed: false }); },
    move(direction: -1 | 1) {
      if (!alive || !state.grabbed || state.finishing) return;
      moves.push({ key: state.focusedKey, direction }); pump();
    },
    loadMore() {
      if (!alive || !state.nextCursor || more || state.finishing) return;
      more = true; pump();
    },
    async finish(): Promise<TvPage<T>> {
      publish({ grabbed: false, finishing: true });
      more = false;
      // Every already accepted move is retained, including a quick Back while
      // the final native write is still running. New input is ignored.
      await worker;
      return { items: state.items, totalCount: state.totalCount, nextCursor: state.nextCursor };
    },
    dispose() { alive = false; more = false; moves.length = 0; },
  };
}

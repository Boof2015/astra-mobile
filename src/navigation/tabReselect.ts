/**
 * Re-tap bus for the tab bar.
 *
 * The bar is the only place that knows a press landed on the tab that was
 * already focused — `actuallyFocused`, which the hidden `stats` route makes
 * non-obvious (see `statsTabState`) — and each screen is the only place that
 * knows how to get its own list back to the top. This is the one-way channel
 * between them.
 *
 * Deliberately not `navigation.emit({ type: 'tabPress' })`: that event is
 * targeted at the tab *route* key, so a screen inside the Library stack has to
 * reach it through `getParent()` while Home would not, and each screen would
 * have to re-derive "was I already focused" instead of leaving that one
 * question with the handler that already gets the stats case right. A plain
 * module is also unit-testable, which the emitter path is not.
 */

type TabReselectListener = () => void;

const listeners = new Map<string, Set<TabReselectListener>>();

export function subscribeTabReselect(
  tabName: string,
  listener: TabReselectListener
): () => void {
  const existing = listeners.get(tabName);
  const set = existing ?? new Set<TabReselectListener>();
  if (!existing) listeners.set(tabName, set);
  set.add(listener);
  return () => {
    set.delete(listener);
    // Drop the bucket with its last listener so remounts can't leak entries.
    if (set.size === 0) listeners.delete(tabName);
  };
}

export function emitTabReselect(tabName: string): void {
  const set = listeners.get(tabName);
  if (!set) return;
  // Snapshot: a listener is allowed to unsubscribe while the set is walked.
  for (const listener of [...set]) listener();
}

/** Test seam — the bus is module state, so leaks are otherwise invisible. */
export function tabReselectListenerCount(tabName: string): number {
  return listeners.get(tabName)?.size ?? 0;
}

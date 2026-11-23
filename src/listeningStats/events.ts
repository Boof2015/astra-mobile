export interface ListeningHistoryChange {
  qualifiedNow?: boolean;
  cleared?: boolean;
}

const listeners = new Set<(change: ListeningHistoryChange) => void>();

export function subscribeToListeningHistory(
  listener: (change: ListeningHistoryChange) => void,
): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function notifyListeningHistoryChanged(change: ListeningHistoryChange = {}): void {
  listeners.forEach((listener) => listener(change));
}

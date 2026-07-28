export interface ListeningHistoryChange {
  qualifiedNow: boolean;
}

const listeners = new Set<(change: ListeningHistoryChange) => void>();

export function subscribeToListeningHistory(
  listener: (change: ListeningHistoryChange) => void,
): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function notifyListeningHistoryChanged(qualifiedNow = false): void {
  const change = { qualifiedNow };
  listeners.forEach((listener) => listener(change));
}

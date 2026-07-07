export interface KeyedQueueEntry {
  key: string;
}

export interface QueueItemRemoveAction<T extends KeyedQueueEntry> {
  absoluteIndex: number;
  nextEntries: T[];
}

export interface SelectedQueueAction<T extends KeyedQueueEntry> {
  absoluteIndices: number[];
  entriesWithSelectedFirst: T[];
  entriesWithoutSelected: T[];
}

export function removeQueueEntryAt<T extends KeyedQueueEntry>(
  entries: readonly T[],
  localIndex: number,
  baseOffset: number
): QueueItemRemoveAction<T> | null {
  if (localIndex < 0 || localIndex >= entries.length) return null;

  return {
    absoluteIndex: baseOffset + localIndex,
    nextEntries: entries.filter((_, index) => index !== localIndex),
  };
}

export function resolveSelectedQueueAction<T extends KeyedQueueEntry>(
  entries: readonly T[],
  selectedKeys: ReadonlySet<string>,
  baseOffset: number
): SelectedQueueAction<T> {
  const selectedEntries: T[] = [];
  const remainingEntries: T[] = [];
  const absoluteIndices: number[] = [];

  entries.forEach((entry, index) => {
    if (selectedKeys.has(entry.key)) {
      selectedEntries.push(entry);
      absoluteIndices.push(baseOffset + index);
    } else {
      remainingEntries.push(entry);
    }
  });

  return {
    absoluteIndices,
    entriesWithSelectedFirst: [...selectedEntries, ...remainingEntries],
    entriesWithoutSelected: remainingEntries,
  };
}

export interface KeyedQueueEntry {
  key: string;
}

export type QueueIndexByKey = Record<string, number>;

export interface QueueItemRemoveAction<T extends KeyedQueueEntry> {
  absoluteIndex: number;
  nextEntries: T[];
}

export interface SelectedQueueAction<T extends KeyedQueueEntry> {
  absoluteIndices: number[];
  entriesWithSelectedFirst: T[];
  entriesWithoutSelected: T[];
}

export function indexQueueEntriesByKey<T extends KeyedQueueEntry>(
  entries: readonly T[]
): QueueIndexByKey {
  const out: QueueIndexByKey = {};
  entries.forEach((entry, index) => {
    out[entry.key] = index;
  });
  return out;
}

export function moveQueueEntry<T>(entries: readonly T[], from: number, to: number): T[] {
  const nextEntries = [...entries];
  if (
    from === to ||
    from < 0 ||
    to < 0 ||
    from >= nextEntries.length ||
    to >= nextEntries.length
  ) {
    return nextEntries;
  }

  const [moved] = nextEntries.splice(from, 1);
  nextEntries.splice(to, 0, moved);
  return nextEntries;
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

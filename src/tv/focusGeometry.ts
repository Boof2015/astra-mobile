export type Direction = 'up' | 'down' | 'left' | 'right';
export type FocusLinks = Partial<Record<Direction, string>>;

/** Row ends stop. A short final row clamps to its last real cell; Up then uses
 * that cell's actual column, rather than an invisible remembered column. */
export function gridNeighbor(index: number, count: number, columns: number, direction: Direction): number {
  if (count <= 0) return 0;
  const last = count - 1;
  const i = Math.max(0, Math.min(index, last));
  const column = i % columns;
  if (direction === 'left') return column > 0 ? i - 1 : i;
  if (direction === 'right') return column < columns - 1 ? Math.min(i + 1, last) : i;
  if (direction === 'up') return i >= columns ? i - columns : i;
  return Math.floor(i / columns) < Math.floor(last / columns) ? Math.min(i + columns, last) : i;
}

export function anchoredStart(index: number, count: number, visible: number, anchor: number): number {
  return Math.max(0, Math.min(index - anchor, count - visible));
}

/** Preserve identity through refreshes; removal lands on the next slot or the
 * previous slot at the end. Empty collections hand focus back to their tools. */
export function restoredIndex(keys: readonly string[], key: string | undefined, previous: number): number {
  const found = key === undefined ? -1 : keys.indexOf(key);
  return found >= 0 ? found : Math.max(0, Math.min(previous, keys.length - 1));
}

export function shelfOffset(index: number, count: number, pitch = 146.2, card = 127, width = 858): number {
  return Math.min(index * pitch, Math.max(0, count * pitch - (pitch - card) - width));
}

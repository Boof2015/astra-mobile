export type SortDirection = 'asc' | 'desc';

export const SORT_DIRECTION_LABELS: Record<SortDirection, string> = {
  asc: 'Ascending',
  desc: 'Descending',
};

export const SORT_DIRECTIONS: readonly SortDirection[] = ['asc', 'desc'];

export function parseSortDirection(value: string | null): SortDirection | null {
  return value === 'asc' || value === 'desc' ? value : null;
}

export function compareDirected<T>(
  left: T,
  right: T,
  direction: SortDirection,
  compare: (a: T, b: T) => number,
): number {
  const result = compare(left, right);
  return direction === 'desc' ? -result : result;
}

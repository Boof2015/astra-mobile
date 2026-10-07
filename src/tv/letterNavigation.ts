export const TV_LETTERS = [...'ABCDEFGHIJKLMNOPQRSTUVWXYZ', '#'];

/** Matches the catalog's SortKeys.sectionLabel, including accented initials. */
export function tvSectionLabel(value: string): string {
  const first = value.trim().normalize('NFD').charAt(0).toUpperCase();
  return /^[A-Z]$/.test(first) ? first : '#';
}

/** Empty letters advance through the picker; neither edge wraps. */
export function nextAvailableLetter(letter: string, present: readonly string[]): string | null {
  const start = TV_LETTERS.indexOf(letter);
  return start < 0 ? null : TV_LETTERS.slice(start).find(value => present.includes(value)) ?? null;
}

/** Hold follows catalog order. Up first reaches the current section's start. */
export function heldSection(labels: readonly string[], current: string, direction: 'up' | 'down', atStart: boolean): string | null {
  const index = labels.indexOf(current);
  if (index < 0) return null;
  if (direction === 'up' && !atStart) return current;
  return labels[index + (direction === 'up' ? -1 : 1)] ?? null;
}

export function heldPage(index: number, count: number, size: number, direction: 'up' | 'down'): number {
  const page = Math.floor(index / size);
  if (direction === 'down') return (page + 1) * size < count ? (page + 1) * size : index;
  return Math.max(0, index % size ? page : page - 1) * size;
}

// A-Z fast-scroll support: bucket a sorted list by first letter so the rail
// can jump to the first item of each letter. Diacritics fold to their base
// letter (NFD strip); digits/punctuation/non-Latin bucket under '#'.

export const RAIL_LETTERS: readonly string[] = [
  '#',
  ...Array.from({ length: 26 }, (_, i) => String.fromCharCode(65 + i)),
];

export interface LetterIndexEntry {
  letter: string;
  firstIndex: number;
}

export function letterFor(value: string): string {
  const first = value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .charAt(0)
    .toUpperCase();
  return first >= 'A' && first <= 'Z' ? first : '#';
}

/** First occurrence of each letter in display order (input assumed sorted by key). */
export function buildLetterIndex<T>(
  items: readonly T[],
  keyOf: (item: T) => string
): LetterIndexEntry[] {
  const firstByLetter = new Map<string, number>();
  items.forEach((item, index) => {
    const letter = letterFor(keyOf(item));
    if (!firstByLetter.has(letter)) firstByLetter.set(letter, index);
  });
  return Array.from(firstByLetter, ([letter, firstIndex]) => ({ letter, firstIndex }));
}

/**
 * Item index for a scrubbed rail letter. Exact bucket when present; otherwise
 * the nearest previous existing letter, so scrubbing over gaps stays monotonic.
 */
export function resolveJumpIndex(index: readonly LetterIndexEntry[], letter: string): number | null {
  if (index.length === 0) return null;
  const exact = index.find((entry) => entry.letter === letter);
  if (exact) return exact.firstIndex;
  if (letter !== '#') {
    for (let code = letter.charCodeAt(0) - 1; code >= 65; code--) {
      const previous = index.find((entry) => entry.letter === String.fromCharCode(code));
      if (previous) return previous.firstIndex;
    }
    const hash = index.find((entry) => entry.letter === '#');
    if (hash) return hash.firstIndex;
  }
  return index[0].firstIndex;
}

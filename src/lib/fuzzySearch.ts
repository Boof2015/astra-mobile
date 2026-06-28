const WORD_BOUNDARY_SEPARATORS = new Set([
  ' ',
  '\t',
  '-',
  '_',
  '/',
  '.',
  ',',
  ':',
  ';',
  '(',
  ')',
  '[',
  ']',
  '{',
  '}',
  '"',
  "'",
]);

function normalizeSearchValue(value: string): string {
  return value.toLocaleLowerCase().trim().replace(/\s+/g, ' ');
}

function isWordBoundary(value: string, index: number): boolean {
  if (index <= 0) return true;
  return WORD_BOUNDARY_SEPARATORS.has(value[index - 1]);
}

export function fuzzyScore(queryInput: string, candidateInput: string): number | null {
  const query = normalizeSearchValue(queryInput);
  const candidate = normalizeSearchValue(candidateInput);

  if (!query || !candidate) return null;

  let queryIndex = 0;
  let firstMatchIndex = -1;
  let lastMatchIndex = -1;
  let previousMatchIndex = -2;
  let contiguousMatches = 0;
  let boundaryMatches = 0;
  let score = 0;

  for (let candidateIndex = 0; candidateIndex < candidate.length; candidateIndex += 1) {
    if (candidate[candidateIndex] !== query[queryIndex]) continue;

    if (firstMatchIndex === -1) {
      firstMatchIndex = candidateIndex;
    }

    const contiguous = candidateIndex === previousMatchIndex + 1;
    const boundary = isWordBoundary(candidate, candidateIndex);

    if (queryIndex === 0) {
      if (candidateIndex === 0) {
        score += 20;
      } else if (boundary) {
        score += 12;
      }
    }

    if (boundary) boundaryMatches += 1;
    if (contiguous) contiguousMatches += 1;

    previousMatchIndex = candidateIndex;
    lastMatchIndex = candidateIndex;
    queryIndex += 1;

    if (queryIndex === query.length) break;
  }

  if (queryIndex !== query.length || firstMatchIndex < 0 || lastMatchIndex < 0) {
    return null;
  }

  const span = lastMatchIndex - firstMatchIndex + 1;
  score += query.length * 8;
  score += contiguousMatches * 5;
  score += boundaryMatches * 4;
  score += Math.max(0, 16 - span);
  score += Math.max(0, 10 - firstMatchIndex);
  score += Math.max(0, 10 - (candidate.length - query.length));

  return score;
}

export interface FieldDef {
  value: string | null | undefined;
  weight: number;
}

export const MIN_SCORE_THRESHOLD = 25;

export function multiFieldScore(queryInput: string, fields: FieldDef[]): number | null {
  const normalizedQuery = normalizeSearchValue(queryInput);
  if (!normalizedQuery) return null;

  let bestScore: number | null = null;

  for (const field of fields) {
    const value = field.value ?? '';
    const normalizedValue = normalizeSearchValue(value);
    if (!normalizedValue) continue;

    let fieldScore = fuzzyScore(queryInput, value);
    if (fieldScore === null) continue;

    if (normalizedValue === normalizedQuery) {
      fieldScore += 60;
    }

    if (normalizedValue.includes(normalizedQuery)) {
      fieldScore += 30;
    }

    if (normalizedValue.startsWith(normalizedQuery)) {
      fieldScore += 20;
    }

    const words = normalizedValue.split(/\s+/);
    if (words.some((word) => word.startsWith(normalizedQuery))) {
      fieldScore += 15;
    }

    fieldScore = Math.round(fieldScore * field.weight);

    if (bestScore === null || fieldScore > bestScore) {
      bestScore = fieldScore;
    }
  }

  if (bestScore === null) return null;

  if (normalizedQuery.length <= 2) {
    const hasStrictMatch = fields.some((field) => {
      const normalizedValue = normalizeSearchValue(field.value ?? '');
      if (!normalizedValue) return false;
      if (normalizedValue.startsWith(normalizedQuery)) return true;
      return normalizedValue.split(/\s+/).some((word) => word.startsWith(normalizedQuery));
    });
    if (!hasStrictMatch) return null;
  }

  return bestScore;
}

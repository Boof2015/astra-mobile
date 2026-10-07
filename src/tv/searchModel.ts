import { findFuzzyMatch } from '../lib/fuzzySearch.ts';

export type SearchName = { name: string; kind: 'Artist' | 'Album' | 'Playlist' | 'Track' };
export type SearchSuggestion = SearchName & { indices: number[] };
const order = { Artist: 0, Album: 1, Playlist: 2, Track: 3 };

export function searchSuggestions(query: string, names: SearchName[], limit: number): SearchSuggestion[] {
  const seen = new Set<string>();
  return names.flatMap(item => {
    const match = findFuzzyMatch(query, item.name);
    return match && ['exact', 'prefix', 'word-prefix'].includes(match.kind) ? [{ ...item, indices: match.indices, prefix: match.startIndex === 0 }] : [];
  }).sort((a, b) => Number(b.prefix) - Number(a.prefix) || order[a.kind] - order[b.kind] || a.name.localeCompare(b.name))
    .filter(item => { const key = item.name.toLocaleLowerCase(); if (seen.has(key)) return false; seen.add(key); return true; })
    .slice(0, limit).map(({ name, kind, indices }) => ({ name, kind, indices }));
}

export function rememberSearch(history: string[], query: string) {
  const trimmed = query.trim();
  return trimmed ? [trimmed, ...history.filter(item => item.toLocaleLowerCase() !== trimmed.toLocaleLowerCase())].slice(0, 5) : history;
}

export function parseSearchHistory(value: string | null | undefined): string[] {
  try {
    const parsed: unknown = JSON.parse(value ?? '[]');
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is string => typeof item === 'string').reverse().reduce(rememberSearch, [] as string[]);
  } catch { return []; }
}

export function highlightedName(name: string, indices: number[]): { text: string; strong: boolean }[] {
  const matched = new Set(indices); const runs: { text: string; strong: boolean }[] = [];
  let offset = 0;
  for (const char of name) {
    const strong = matched.has(offset); const last = runs.at(-1);
    if (last?.strong === strong) last.text += char; else runs.push({ text: char, strong });
    offset += char.length;
  }
  return runs;
}

/** Appending carries the catalog revision so a scan cannot splice two snapshots. */
export function searchCursor(cursor: string | null) {
  if (!cursor) return { offset: 0, revision: null };
  const [revision, offset] = cursor.split(':').map(Number);
  return { offset, revision };
}

import { normalizeArtistNames } from '../shared/library/artistCredits.ts';

export function serializeArtistCreditTransport(
  names: readonly unknown[] | null | undefined
): string | undefined {
  const normalized = normalizeArtistNames(names);
  return normalized.length > 0 ? JSON.stringify(normalized) : undefined;
}

export function parseArtistCreditTransport(value: unknown): string[] | undefined {
  if (typeof value !== 'string' || value.trim().length === 0) return undefined;
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) return undefined;
    const names = normalizeArtistNames(parsed);
    return names.length > 0 ? names : undefined;
  } catch {
    return undefined;
  }
}

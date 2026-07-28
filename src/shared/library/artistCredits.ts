// Shared credit normalization. Structured arrays retain exact artist
// boundaries; display punctuation must come from the tags or use neutral
// comma separators rather than inventing collaboration punctuation.

export interface ArtistNameToken {
  artist: string;
  separator: string | null;
}

export function normalizeArtistName(value: unknown): string {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
}

export function normalizeArtistNames(values: readonly unknown[] | null | undefined): string[] {
  if (!values) return [];

  const unique = new Map<string, string>();
  for (const value of values) {
    const display = normalizeArtistName(value);
    if (!display) continue;
    const key = display.toLocaleLowerCase();
    if (!key || unique.has(key)) continue;
    unique.set(key, display);
  }

  return Array.from(unique.values());
}

export function serializeArtistNames(names: readonly unknown[] | null | undefined): string | null {
  const normalized = normalizeArtistNames(names);
  return normalized.length > 0 ? JSON.stringify(normalized) : null;
}

export function deserializeArtistNames(value: unknown): string[] {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return [];
  }

  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? normalizeArtistNames(parsed) : [];
  } catch {
    return [];
  }
}

export function formatArtistNames(names: readonly unknown[] | null | undefined): string {
  return normalizeArtistNames(names).join(', ');
}

export function buildArtistNameTokens(names: readonly unknown[] | null | undefined): ArtistNameToken[] {
  const normalized = normalizeArtistNames(names);
  return normalized.map((artist, index) => ({
    artist,
    separator: index < normalized.length - 1 ? ', ' : null,
  }));
}

const LITERAL_SEPARATOR_PATTERN = /([,;])/;

/**
 * Build clickable fallback credits from a legacy display string while keeping
 * its literal punctuation. Ampersands are intentionally not split: without
 * structured metadata, they may be part of an artist's actual name or tag.
 */
export function parseArtistMetadata(artistText: string): ArtistNameToken[] {
  const normalized = normalizeArtistName(artistText);
  if (!normalized) return [];

  const tokens: ArtistNameToken[] = [];
  let pendingSeparator: ',' | ';' | null = null;

  for (const part of normalized.split(LITERAL_SEPARATOR_PATTERN)) {
    if (part === ',' || part === ';') {
      pendingSeparator = part;
      continue;
    }

    const artist = normalizeArtistName(part);
    if (!artist) continue;

    if (pendingSeparator && tokens.length > 0) {
      tokens[tokens.length - 1].separator = `${pendingSeparator} `;
    }
    tokens.push({ artist, separator: null });
    pendingSeparator = null;
  }

  return tokens.length > 0 ? tokens : [{ artist: normalized, separator: null }];
}

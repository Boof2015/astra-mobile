import type { AdaptiveAccentTarget } from './adaptiveAccent.ts';
import type { CoverArtAccentMethod } from './artworkAccentPreferences.ts';

export interface ArtworkAccentCacheResult<T = string | null> {
  found: boolean;
  value: T | null;
}

/** Small LRU. Holds accents by default; the backdrop field reuses it for its own values. */
export class ArtworkAccentCache<T = string | null> {
  private readonly entries = new Map<string, T | null>();
  private readonly maxEntries: number;

  constructor(maxEntries = 256) {
    this.maxEntries = maxEntries;
  }

  get(key: string): ArtworkAccentCacheResult<T> {
    if (!this.entries.has(key)) return { found: false, value: null };
    const value = this.entries.get(key) ?? null;
    this.entries.delete(key);
    this.entries.set(key, value);
    return { found: true, value };
  }

  set(key: string, value: T | null): void {
    this.entries.delete(key);
    this.entries.set(key, value);
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
  }

  get size(): number {
    return this.entries.size;
  }
}

export function artworkAccentCacheKey(
  artworkIdentity: string,
  artworkSourceHash: string,
  method: CoverArtAccentMethod,
  target: AdaptiveAccentTarget,
): string {
  const themeKey = method === 'adaptive'
    ? `${target.isLight ? 'light' : 'dark'}:${target.onAccent}:`
    : '';
  return `${method}:${themeKey}${artworkIdentity}:${artworkSourceHash}`;
}

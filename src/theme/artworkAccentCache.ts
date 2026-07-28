export interface ArtworkAccentCacheResult {
  found: boolean;
  value: string | null;
}

export class ArtworkAccentCache {
  private readonly entries = new Map<string, string | null>();
  private readonly maxEntries: number;

  constructor(maxEntries = 256) {
    this.maxEntries = maxEntries;
  }

  get(key: string): ArtworkAccentCacheResult {
    if (!this.entries.has(key)) return { found: false, value: null };
    const value = this.entries.get(key) ?? null;
    this.entries.delete(key);
    this.entries.set(key, value);
    return { found: true, value };
  }

  set(key: string, value: string | null): void {
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

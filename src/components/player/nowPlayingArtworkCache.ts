export interface ArtworkRequest {
  uri: string;
  pixelSize: number;
}

export function artworkRequestKey({ uri, pixelSize }: ArtworkRequest): string {
  return JSON.stringify([uri, pixelSize]);
}

/**
 * A small, owner-scoped decode window, not another application image cache.
 * The caller supplies visible covers first, then immediate queue neighbors.
 * In-flight work is deduplicated even when rapid skips remove/re-add a cover.
 * Dropping a result releases our reference; mounted native images retain their
 * own drawable, so we must not explicitly invalidate a shared ImageRef.
 */
export class NowPlayingArtworkCache<T> {
  private wanted = new Map<string, ArtworkRequest>();
  private ready = new Map<string, T>();
  private loading = new Set<string>();
  private failed = new Set<string>();
  private listeners = new Set<() => void>();
  private epoch = 0;

  private load: (request: ArtworkRequest) => Promise<T>;

  constructor(load: (request: ArtworkRequest) => Promise<T>) {
    this.load = load;
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };

  get = (request: ArtworkRequest): T | null => this.ready.get(artworkRequestKey(request)) ?? null;

  setRequests(requests: readonly ArtworkRequest[]): void {
    this.wanted = new Map(requests.map((request) => [artworkRequestKey(request), request]));
    let changed = false;
    for (const key of this.ready.keys()) {
      if (!this.wanted.has(key)) changed = this.ready.delete(key) || changed;
    }
    for (const key of this.failed) {
      if (!this.wanted.has(key)) this.failed.delete(key);
    }
    if (changed) this.notify();
    this.pump();
  }

  clear(): void {
    this.epoch += 1;
    this.wanted.clear();
    this.ready.clear();
    this.failed.clear();
    this.notify();
  }

  private notify(): void {
    for (const listener of this.listeners) listener();
  }

  private pump(): void {
    for (const [key, request] of this.wanted) {
      // Bound native decode work as well as retained images. A new visible
      // cover takes the next free slot ahead of queued neighbor work.
      if (this.loading.size >= 2) return;
      if (this.loading.has(key) || this.ready.has(key) || this.failed.has(key)) continue;
      const epoch = this.epoch;
      this.loading.add(key);
      void Promise.resolve().then(() => this.load(request)).then((image) => {
        if (epoch !== this.epoch || !this.wanted.has(key)) return;
        this.ready.set(key, image);
        this.notify();
      }, () => {
        if (epoch === this.epoch && this.wanted.has(key)) this.failed.add(key);
      }).finally(() => {
        this.loading.delete(key);
        this.pump();
      });
    }
  }
}

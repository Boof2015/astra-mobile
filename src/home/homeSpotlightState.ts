import type {
  HomeSpotlightIdentity,
  HomeSpotlightPreferences,
  HomeSpotlightRequest,
  NativeHomeSpotlight,
} from '../../modules/astra-library-scanner';
import type { Album, Artist } from '../types/library';

export type HomeSpotlight = NativeHomeSpotlight<Album, Artist>;
export const HOME_SPOTLIGHT_HISTORY_LIMIT = 20;
export const HOME_SPOTLIGHT_HISTORY_KEY = 'home_spotlight_history_v1';

export function sameSpotlight(a: HomeSpotlightIdentity | null, b: HomeSpotlightIdentity | null): boolean {
  return a === b || (a !== null && b !== null && a.kind === b.kind && a.key === b.key
    && (a.kind !== 'artist' || (b.kind === 'artist' && a.groupingMode === b.groupingMode)));
}

export function rememberSpotlight(
  history: readonly HomeSpotlightIdentity[], identity: HomeSpotlightIdentity,
): readonly HomeSpotlightIdentity[] {
  if (sameSpotlight(history.at(-1) ?? null, identity)) return history;
  return [...history.filter((item) => !sameSpotlight(item, identity)), identity].slice(-HOME_SPOTLIGHT_HISTORY_LIMIT);
}

export function parseSpotlightHistory(raw: string | null): readonly HomeSpotlightIdentity[] {
  try {
    const value: unknown = JSON.parse(raw ?? '[]');
    if (!Array.isArray(value)) return [];
    let history: readonly HomeSpotlightIdentity[] = [];
    for (const item of value) {
      if (!item || typeof item !== 'object' || typeof item.key !== 'string' || !item.key.trim()) continue;
      if (item.kind === 'album') history = rememberSpotlight(history, { kind: 'album', key: item.key });
      if (item.kind === 'artist' && (item.groupingMode === 'astra' || item.groupingMode === 'fileTags')) {
        history = rememberSpotlight(history, { kind: 'artist', key: item.key, groupingMode: item.groupingMode });
      }
    }
    return history;
  } catch {
    return [];
  }
}

export function createSpotlightHistory(deps: {
  read: () => Promise<string | null>;
  write: (value: string) => Promise<void>;
  warn: (error: unknown) => void;
}) {
  let history: readonly HomeSpotlightIdentity[] = [];
  let loading: Promise<void> | null = null;
  let writes = Promise.resolve();
  return {
    load() {
      loading ??= deps.read().then((raw) => { history = parseSpotlightHistory(raw); }).catch(deps.warn);
      return loading;
    },
    recent: () => history,
    record(identity: HomeSpotlightIdentity) {
      const next = rememberSpotlight(history, identity);
      if (next === history) return;
      history = next;
      const value = JSON.stringify(next);
      writes = writes.then(() => deps.write(value)).catch(deps.warn);
    },
    flush: () => writes,
  };
}

interface SpotlightSnapshot {
  spotlight: HomeSpotlight | null;
  busy: boolean;
}

/** Lifecycle outside React so requests, focus changes, and catalog invalidations
 * share one gate. History is committed separately, after React displays a result. */
export function createHomeSpotlightController(deps: {
  history: ReturnType<typeof createSpotlightHistory>;
  choose: (request: HomeSpotlightRequest) => Promise<HomeSpotlight | null>;
  warn: (error: unknown) => void;
}) {
  let snapshot: SpotlightSnapshot = { spotlight: null, busy: false };
  let preferences: HomeSpotlightPreferences | null = null;
  let active = false;
  let dirty = true;
  let running = false;
  let generation = 0;
  let recorded: HomeSpotlightIdentity | null = null;
  const listeners = new Set<() => void>();
  const publish = (next: SpotlightSnapshot) => {
    snapshot = next;
    listeners.forEach((listener) => listener());
  };

  async function request(reroll: boolean) {
    if (!active || !preferences || running) return;
    running = true;
    const version = ++generation;
    const selectedPreferences = preferences;
    publish({ ...snapshot, busy: true });
    try {
      await deps.history.load();
      if (!active || version !== generation) return;
      const current = snapshot.spotlight?.identity ?? null;
      const result = await deps.choose({
        ...selectedPreferences,
        // Protect the visible card even if a tap precedes its commit effect.
        recent: current ? rememberSpotlight(deps.history.recent(), current) : deps.history.recent(),
        retain: reroll ? null : current,
      });
      if (!active || version !== generation) return;
      dirty = false;
      publish({ spotlight: result, busy: false });
    } catch (error) {
      if (version === generation) deps.warn(error);
    } finally {
      running = false;
      if (version === generation && snapshot.busy) publish({ ...snapshot, busy: false });
      // Coalesce invalidations arriving during a request into one fresh read.
      if (active && preferences && dirty && version !== generation) void request(false);
    }
  }

  function invalidate() {
    dirty = true;
    generation += 1;
    if (active) void request(false);
  }

  return {
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    configure(next: HomeSpotlightPreferences | null) {
      if (preferences?.includeSingles === next?.includeSingles
        && preferences?.groupingMode === next?.groupingMode
        && preferences?.includeCollaborations === next?.includeCollaborations) return;
      preferences = next;
      invalidate();
    },
    setActive(value: boolean) {
      active = value;
      if (!active) {
        if (running) dirty = true;
        generation += 1;
        if (snapshot.busy) publish({ ...snapshot, busy: false });
      } else if (dirty) {
        void request(false);
      }
    },
    invalidate,
    reroll: () => { void request(true); },
    markShown() {
      const identity = snapshot.spotlight?.identity;
      if (!active || !identity || sameSpotlight(recorded, identity)) return;
      recorded = identity;
      deps.history.record(identity);
    },
  };
}

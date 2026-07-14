export interface DspWarmupInputs<Settings, Route, PersistedFallback> {
  settings: Settings;
  route: Route;
  persistedFallback: PersistedFallback;
}

export interface DspStartupTiming {
  stage: 'base' | 'target';
  reason: string;
  elapsedMs: number;
  status: 'ready' | 'failed';
}

export interface DspStartupDependencies<Settings, Route, PersistedFallback, Target> {
  loadSettings: () => Promise<Settings>;
  loadEqRoute: () => Promise<Route>;
  loadPersistedFallback: () => Promise<PersistedFallback>;
  applyBase: (
    inputs: DspWarmupInputs<Settings, Route, PersistedFallback>,
  ) => void | Promise<void>;
  prepareTarget: (
    inputs: DspWarmupInputs<Settings, Route, PersistedFallback>,
    target: Target,
  ) => void | Promise<void>;
  now?: () => number;
  onTiming?: (timing: DspStartupTiming) => void;
}

/**
 * Coalesces the cold DSP warm-up while keeping per-track priming explicit.
 *
 * The three persisted inputs deliberately start in the same turn. Invalidating
 * never releases a waiter with stale state: an in-flight generation joins the
 * replacement warm-up before it resolves.
 */
export class DspStartupCoordinator<Settings, Route, PersistedFallback, Target> {
  private basePromise: Promise<DspWarmupInputs<Settings, Route, PersistedFallback>> | null = null;
  private generation = 0;
  private readonly dependencies: DspStartupDependencies<
    Settings,
    Route,
    PersistedFallback,
    Target
  >;

  constructor(
    dependencies: DspStartupDependencies<
      Settings,
      Route,
      PersistedFallback,
      Target
    >,
  ) {
    this.dependencies = dependencies;
  }

  warm(reason: string): Promise<DspWarmupInputs<Settings, Route, PersistedFallback>> {
    if (this.basePromise) return this.basePromise;

    const generation = this.generation;
    const now = this.dependencies.now ?? Date.now;
    const startedAt = now();
    let tracked: Promise<DspWarmupInputs<Settings, Route, PersistedFallback>>;

    const task = (async () => {
      const [settings, route, persistedFallback] = await Promise.all([
        this.dependencies.loadSettings(),
        this.dependencies.loadEqRoute(),
        this.dependencies.loadPersistedFallback(),
      ]);

      if (generation !== this.generation) return this.warm(reason);

      const inputs = { settings, route, persistedFallback };
      await this.dependencies.applyBase(inputs);

      if (generation !== this.generation) return this.warm(reason);

      this.dependencies.onTiming?.({
        stage: 'base',
        reason,
        elapsedMs: now() - startedAt,
        status: 'ready',
      });
      return inputs;
    })();

    tracked = task.catch((error) => {
      if (this.basePromise === tracked) this.basePromise = null;
      this.dependencies.onTiming?.({
        stage: 'base',
        reason,
        elapsedMs: now() - startedAt,
        status: 'failed',
      });
      throw error;
    });
    this.basePromise = tracked;
    return tracked;
  }

  async prepare(target: Target, reason: string): Promise<void> {
    const now = this.dependencies.now ?? Date.now;
    const startedAt = now();

    try {
      // Settings can change while a track lookup is in flight. Repeat against
      // the newest generation rather than releasing playback with stale gain.
      while (true) {
        const generation = this.generation;
        const inputs = await this.warm(reason);
        if (generation !== this.generation) continue;
        await this.dependencies.prepareTarget(inputs, target);
        if (generation !== this.generation) continue;
        break;
      }
      this.dependencies.onTiming?.({
        stage: 'target',
        reason,
        elapsedMs: now() - startedAt,
        status: 'ready',
      });
    } catch (error) {
      this.dependencies.onTiming?.({
        stage: 'target',
        reason,
        elapsedMs: now() - startedAt,
        status: 'failed',
      });
      throw error;
    }
  }

  invalidate(): void {
    this.generation += 1;
    this.basePromise = null;
  }

  rewarm(reason: string): Promise<DspWarmupInputs<Settings, Route, PersistedFallback>> {
    this.invalidate();
    return this.warm(reason);
  }
}

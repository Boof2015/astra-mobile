// Pure scheduling policy, shared by visible waveforms and headless normalization.
export type AnalysisPriority = 'interactive' | 'prefetch';

export interface AnalysisRequirements {
  peaks: boolean;
  priority: AnalysisPriority;
  durationMs?: number;
}

export interface AnalysisAttempt {
  id: string;
  path: string;
  signal: AbortSignal;
  /** Mutable requirements: joining callers can request peaks or promote this job. */
  requirements: AnalysisRequirements;
  schedulerWaitMs: number;
  readonly promoted: boolean;
  /** Acknowledge merged requirements at the cache/decode decision boundary. */
  acknowledgeRequirements: () => void;
}

interface Job<T> {
  path: string;
  requirements: AnalysisRequirements;
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
  controller: AbortController;
  attempt: AnalysisAttempt | null;
  requestedAt: number;
  promoted: boolean;
  restart: boolean;
  revision: number;
  handledRevision: number;
}

export class AnalysisCoordinator<T> {
  private readonly jobs = new Map<string, Job<T>>();
  private readonly active = new Set<Job<T>>();
  private queue: Job<T>[] = [];
  private currentPath: string | null = null;
  private sequence = 0;
  private readonly session = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  private readonly run: (attempt: AnalysisAttempt) => Promise<T>;
  private readonly cancelledResult: () => T;

  constructor(
    run: (attempt: AnalysisAttempt) => Promise<T>,
    cancelledResult: () => T,
  ) {
    this.run = run;
    this.cancelledResult = cancelledResult;
  }

  request(path: string, requirements: AnalysisRequirements): Promise<T> {
    if (requirements.priority === 'interactive') this.setCurrentPath(path);
    const existing = this.jobs.get(path);
    if (existing) {
      if (requirements.peaks && !existing.requirements.peaks) {
        existing.requirements.peaks = true;
        existing.revision += 1;
      }
      if (requirements.durationMs && requirements.durationMs > 0) {
        existing.requirements.durationMs = requirements.durationMs;
      }
      if (requirements.priority === 'interactive') this.promote(existing);
      if (existing.controller.signal.aborted) existing.restart = true;
      this.pump();
      return existing.promise;
    }
    let resolve!: (value: T) => void;
    let reject!: (error: unknown) => void;
    const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
    const job: Job<T> = {
      path, requirements: { ...requirements }, promise, resolve, reject,
      controller: new AbortController(), attempt: null, requestedAt: Date.now(),
      promoted: false, restart: false, revision: 0, handledRevision: 0,
    };
    this.jobs.set(path, job);
    this.queue.push(job);
    this.pump();
    return promise;
  }

  /** Called on intent, including cached/remote tracks that require no decode. */
  setCurrentPath(path: string | null): void {
    this.currentPath = path;
    for (const job of this.jobs.values()) {
      if (job.path === path) this.promote(job);
      else if (job.requirements.priority === 'interactive') this.cancelJob(job);
    }
  }

  /** Reorder pending prefetch without discarding a useful active decode. */
  reconcilePrefetch(paths: readonly string[]): void {
    const order = new Map(paths.map((path, index) => [path, index]));
    for (const job of this.jobs.values()) {
      if (job.requirements.priority === 'prefetch' && !order.has(job.path)) this.cancelJob(job);
    }
    this.queue.sort((a, b) => (order.get(a.path) ?? -1) - (order.get(b.path) ?? -1));
    this.pump();
  }

  cancel(path: string): void {
    const job = this.jobs.get(path);
    if (job) this.cancelJob(job);
    this.pump();
  }

  cancelAll(): void {
    for (const job of this.jobs.values()) this.cancelJob(job);
  }

  paths(): string[] { return [...this.jobs.keys()]; }

  isCurrentPath(path: string): boolean { return this.currentPath === path; }

  isCurrentAttempt(path: string, id: string): boolean {
    const job = this.jobs.get(path);
    return job?.attempt?.id === id && !job.controller.signal.aborted;
  }

  private promote(job: Job<T>): void {
    if (job.requirements.priority !== 'interactive') {
      job.requirements.priority = 'interactive';
      job.promoted = true;
    }
  }

  private cancelJob(job: Job<T>): void {
    job.restart = false;
    job.controller.abort();
    if (this.active.has(job)) return; // Keep ownership until native teardown finishes.
    this.queue = this.queue.filter((queued) => queued !== job);
    this.jobs.delete(job.path);
    job.resolve(this.cancelledResult());
  }

  private pump(): void {
    while (this.active.size < 2) {
      // Draining cancelled work still counts toward the two-job cap, but cannot
      // monopolize an otherwise free foreground slot (e.g. a slow metadata read).
      const hasInteractive = [...this.active].some((job) =>
        job.requirements.priority === 'interactive' && !job.controller.signal.aborted);
      const hasPrefetch = [...this.active].some((job) => job.requirements.priority === 'prefetch');
      let index = this.queue.findIndex((job) => !hasInteractive && job.requirements.priority === 'interactive');
      if (index < 0 && !hasPrefetch) index = this.queue.findIndex((job) => job.requirements.priority === 'prefetch');
      if (index < 0) return;
      const [job] = this.queue.splice(index, 1);
      this.active.add(job);
      job.handledRevision = job.revision;
      const attempt: AnalysisAttempt = {
        id: `${this.session}-${++this.sequence}`, path: job.path,
        signal: job.controller.signal, requirements: job.requirements,
        schedulerWaitMs: Date.now() - job.requestedAt,
        get promoted() { return job.promoted; },
        acknowledgeRequirements: () => { job.handledRevision = job.revision; },
      };
      job.attempt = attempt;
      // Defer execution one microtask so synchronous callers can merge requirements.
      void Promise.resolve().then(() => this.run(attempt)).then(
        (result) => this.finish(job, result),
        (error: unknown) => this.finish(job, undefined, error),
      );
    }
  }

  private finish(job: Job<T>, result?: T, error?: unknown): void {
    this.active.delete(job);
    job.attempt = null;
    if (job.restart || (!job.controller.signal.aborted && error === undefined && job.handledRevision < job.revision)) {
      job.restart = false;
      job.controller = new AbortController();
      job.requestedAt = Date.now();
      if (job.path !== this.currentPath) job.requirements.priority = 'prefetch';
      this.queue.push(job);
    } else {
      this.jobs.delete(job.path);
      if (job.controller.signal.aborted) job.resolve(this.cancelledResult());
      else if (error !== undefined) job.reject(error);
      else job.resolve(result as T);
    }
    this.pump();
  }
}

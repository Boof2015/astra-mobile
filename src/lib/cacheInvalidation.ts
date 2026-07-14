/** Serializes cache writes and gives clears a generation boundary. */
export class CacheInvalidationGate {
  private generation = 0;
  private mutationQueue: Promise<void> = Promise.resolve();

  capture(): number {
    return this.generation;
  }

  isCurrent(generation: number): boolean {
    return generation === this.generation;
  }

  enqueue(operation: () => Promise<void>): Promise<void> {
    const task = this.mutationQueue.then(operation, operation);
    this.mutationQueue = task.catch(() => {});
    return task;
  }

  invalidate(operation: () => Promise<void>): Promise<void> {
    this.generation += 1;
    return this.enqueue(operation);
  }
}

/** FIFO commands; a rejection must not poison the next request. No background timers. */
export function createCarCommandQueue(): (command: () => Promise<void>) => Promise<void> {
  let tail = Promise.resolve();
  return (command) => {
    const result = tail.then(command);
    tail = result.catch(() => {});
    return result;
  };
}

/** Correlate completion to the request that ran, and discard expired queued work. */
export function createCarCommandCoordinator<T extends { requestId?: string }>(dependencies: {
  isActive: (id: string) => Promise<boolean>;
  execute: (payload: T) => Promise<void>;
  complete: (id: string, error: string | null) => void;
  formatError: (error: unknown) => string;
}): (payload: T) => Promise<void> {
  const enqueue = createCarCommandQueue();
  return (payload) => enqueue(async () => {
    const id = payload.requestId;
    if (id && !await dependencies.isActive(id)) return;
    let error: string | null = null;
    try { await dependencies.execute(payload); }
    catch (cause) { error = dependencies.formatError(cause); }
    finally { if (id) dependencies.complete(id, error); }
  });
}

const carMessages = new Set([
  'This item is unavailable.', 'This item is no longer available.',
  'This action is unavailable.', 'This car control is unavailable.',
  'This track is no longer available.', 'This collection is no longer available.',
  'This collection has no available tracks.', 'This queue item is no longer available.',
  'The queue has changed. Select a song from the current queue.',
  'Choose a song before changing favorites.', 'Choose music from your library to start playback.',
  'Invalid playback position.', 'Invalid shuffle mode.', 'Invalid repeat mode.',
  'No matching music found. Try the song, album, artist, or playlist name.',
]);
export function carCommandError(error: unknown): string {
  const message = error instanceof Error ? error.message : '';
  return carMessages.has(message) ? message : 'Unable to complete this action. Check that the music is available and try again.';
}

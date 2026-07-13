import type { SessionRepeatMode } from './sessionState.ts';

export interface PlaybackMaterialization<T> {
  tracks: T[];
  activeIndex: number;
  position: number;
  repeat: SessionRepeatMode;
}

export interface PlaybackMaterializationEngine<T> {
  loadQueue: (tracks: T[], activeIndex: number) => Promise<void>;
  setRepeat: (repeat: SessionRepeatMode) => Promise<void>;
  seek: (position: number) => Promise<void>;
}

/** Loads and seeks a restored queue without ever issuing Play. */
export async function materializePlaybackQueue<T>(
  session: PlaybackMaterialization<T>,
  engine: PlaybackMaterializationEngine<T>
): Promise<void> {
  await engine.loadQueue(session.tracks, session.activeIndex);
  await engine.setRepeat(session.repeat);
  if (session.position > 0) await engine.seek(session.position);
}

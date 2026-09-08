import type { PlaybackSessionSnapshotV1, SessionRepeatMode } from './sessionState.ts';

interface CarResumeSnapshot {
  path: string | null;
  queuePosition?: number | null;
  position: number;
  shuffle: boolean;
  repeat: SessionRepeatMode;
  savedAt: number;
}

/** A native transition may be newer than the last JavaScript session save. */
export function applyCarResume(
  session: PlaybackSessionSnapshotV1,
  savedAt: number,
  resume: CarResumeSnapshot | null,
): PlaybackSessionSnapshotV1 {
  if (!resume?.path || resume.savedAt <= savedAt) return session;
  const candidate = resume.queuePosition;
  let activeIndex = typeof candidate === 'number' && Number.isInteger(candidate)
    && session.queuePaths[candidate] === resume.path ? candidate : -1;
  if (activeIndex < 0) {
    const first = session.queuePaths.indexOf(resume.path);
    // A path alone cannot distinguish duplicate occurrences after a queue edit.
    if (first >= 0 && first === session.queuePaths.lastIndexOf(resume.path)) activeIndex = first;
  }
  const modes = { position: resume.position, shuffle: resume.shuffle, repeat: resume.repeat };
  if (activeIndex >= 0) return { ...session, ...modes, activeIndex };
  // The saved runtime queue predates this item (or is ambiguous). Restore the
  // known current song instead of selecting an unrelated or duplicate row.
  return { ...session, ...modes, queuePaths: [resume.path], originalOrderPaths: [resume.path], activeIndex: 0 };
}

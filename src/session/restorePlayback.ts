import { AstraLibraryData } from '../../modules/astra-library-scanner';
import { AstraCar } from '../../modules/astra-car';
import { hasActiveNativePlaybackSession, restorePlaybackSession, restoreVirtualPlaybackContext } from '@/audio/playbackController';
import { usePlayerStore } from '@/stores/playerStore';
import { dbTrackToTrack } from '@/library/trackAdapter';
import type { DbTrack } from '@/types/library';
import { readPersistedMobileSession } from './sessionPersistence';
import { applyCarResume } from './carResumeState';
import { resolvePlaybackSession, type PlaybackSessionSnapshotV1 } from './sessionState';

let restoring: Promise<void> | null = null;
/** Shared by headless and UI startup. Hydration never sets up or plays the engine. */
export function restoreSavedPlayback(): Promise<void> {
  if (restoring) return restoring;
  restoring = restore().finally(() => { restoring = null; });
  return restoring;
}

async function restore(): Promise<void> {
  if (usePlayerStore.getState().restoredSessionPending || await hasActiveNativePlaybackSession()) return;
  const [saved, resume] = await Promise.all([readPersistedMobileSession(), AstraCar.getResumeState()]);
  const preferNative = resume?.path && resume.savedAt > (saved?.savedAt ?? 0);
  const session: PlaybackSessionSnapshotV1 | null = saved?.playback ?? (resume?.path ? {
    queuePaths: [resume.path], activeIndex: 0, position: resume.position,
    shuffle: resume.shuffle, repeat: resume.repeat, originalOrderPaths: [resume.path],
    source: { kind: 'android-auto', label: 'Android Auto' },
  } : null);
  if (!session) return;
  // A runtime queue must not be replaced by an older, unrelated Room context.
  const window = resume && resume.savedAt > 0 && !resume.session ? null : await AstraLibraryData.restorePlaybackContext<DbTrack>();
  if (window) {
    let selected = window;
    if (preferNative && resume.session === `${window.sessionId}:${window.sessionEpoch}` && resume.entryId) {
      const position = await AstraCar.resolveQueueEntry(resume.session, resume.entryId);
      if (position != null) {
        await AstraLibraryData.updatePlaybackPosition(window.sessionId, position);
        selected = await AstraLibraryData.getPlaybackWindow<DbTrack>(window.sessionId, Math.max(0, position - 8), 41);
      }
    }
    const activePath = selected.items.find((item) => item.queuePosition === selected.activePosition)?.path;
    const originalPath = session.queuePaths[session.activeIndex];
    const position = preferNative && activePath === resume.path ? resume.position : activePath === originalPath ? session.position : 0;
    if (!usePlayerStore.getState().restoredSessionPending && !await hasActiveNativePlaybackSession()) {
      restoreVirtualPlaybackContext(selected, { ...session, position,
        shuffle: selected.shuffleSeed != null, repeat: preferNative ? resume.repeat : session.repeat });
    }
    return;
  }
  const playback = applyCarResume(session, saved?.savedAt ?? 0, resume);
  const tracks: DbTrack[] = [];
  const paths = [...new Set(playback.queuePaths)];
  for (let offset = 0; offset < paths.length; offset += 100) {
    const batch = await Promise.all(paths.slice(offset, offset + 100).map((path) => AstraLibraryData.getTrack<DbTrack>(path)));
    tracks.push(...batch.filter((track): track is DbTrack => track != null));
  }
  const resolved = resolvePlaybackSession(playback, tracks);
  if (!usePlayerStore.getState().restoredSessionPending && !await hasActiveNativePlaybackSession()) {
    restorePlaybackSession(resolved ? { ...resolved, tracks: resolved.tracks.map(dbTrackToTrack) } : null);
  }
}

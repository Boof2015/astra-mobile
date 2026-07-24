import { AppState } from 'react-native';
import { AstraLibraryData } from '../../modules/astra-library-scanner';
import { getPlaybackSessionSnapshot } from '@/audio/playbackController';
import { usePlayerStore } from '@/stores/playerStore';
import { useQueueStore } from '@/stores/queueStore';
import {
  MOBILE_SESSION_KIND,
  MOBILE_SESSION_SCHEMA_VERSION,
  normalizeStableHref,
  parseMobileSessionSnapshot,
  stringifyMobileSessionSnapshot,
  type MobileSessionSnapshotV1,
  type PlaybackSessionSnapshotV1,
} from './sessionState';

const STRUCTURAL_SAVE_DEBOUNCE_MS = 250;
const POSITION_SAVE_THROTTLE_MS = 2000;

let lastStableHref = '/';
let scheduleStructuralSave: (() => void) | null = null;
let writeChain: Promise<void> = Promise.resolve();

export async function readPersistedMobileSession(): Promise<MobileSessionSnapshotV1 | null> {
  return parseMobileSessionSnapshot(await AstraLibraryData.readMobileSession());
}

async function writePersistedMobileSession(snapshot: MobileSessionSnapshotV1): Promise<void> {
  await AstraLibraryData.writeMobileSession(stringifyMobileSessionSnapshot(snapshot));
}

function enqueueSnapshotWrite(snapshot: MobileSessionSnapshotV1): Promise<void> {
  writeChain = writeChain
    .catch(() => {
      // A failed save must not poison every later queued write.
    })
    .then(() => writePersistedMobileSession(snapshot));
  return writeChain;
}

export function setInitialStableHref(href: string): void {
  lastStableHref = normalizeStableHref(href) ?? '/';
}

export function rememberStableHref(href: string): void {
  const normalized = normalizeStableHref(href);
  if (!normalized || normalized === lastStableHref) return;
  lastStableHref = normalized;
  scheduleStructuralSave?.();
}

function currentSnapshot(
  lastKnownPlayback: PlaybackSessionSnapshotV1 | null
): { snapshot: MobileSessionSnapshotV1; playback: PlaybackSessionSnapshotV1 | null } {
  let playback = getPlaybackSessionSnapshot();
  const queue = useQueueStore.getState();
  // A headless/native session can become visible before its queue mirror has
  // crossed the bridge. Keep the last complete disk snapshot until that read
  // settles rather than briefly overwriting it with an empty queue.
  if (!playback && !queue.hasSnapshot) playback = lastKnownPlayback;

  return {
    snapshot: {
      kind: MOBILE_SESSION_KIND,
      schemaVersion: MOBILE_SESSION_SCHEMA_VERSION,
      savedAt: Date.now(),
      lastStableHref,
      playback,
    },
    playback,
  };
}

function didPlayerStructureChange(
  state: ReturnType<typeof usePlayerStore.getState>,
  previous: ReturnType<typeof usePlayerStore.getState>
): boolean {
  return state.currentTrack?.path !== previous.currentTrack?.path
    || state.shuffle !== previous.shuffle
    || state.repeat !== previous.repeat;
}

export function installMobileSessionPersistence(
  initialPlayback: PlaybackSessionSnapshotV1 | null
): () => void {
  let saveTimer: ReturnType<typeof setTimeout> | null = null;
  let saveDueAt = 0;
  let lastSaveAt = 0;
  let lastKnownPlayback = initialPlayback;

  const clearSaveTimer = () => {
    if (saveTimer !== null) {
      clearTimeout(saveTimer);
      saveTimer = null;
    }
    saveDueAt = 0;
  };

  const saveNow = () => {
    clearSaveTimer();
    lastSaveAt = Date.now();
    const current = currentSnapshot(lastKnownPlayback);
    lastKnownPlayback = current.playback;
    void enqueueSnapshotWrite(current.snapshot).catch((error) => {
      console.warn('[session] save failed', error);
    });
  };

  const scheduleSave = (delayMs: number) => {
    const dueAt = Date.now() + delayMs;
    if (saveTimer !== null && saveDueAt <= dueAt) return;
    clearSaveTimer();
    saveDueAt = dueAt;
    saveTimer = setTimeout(saveNow, delayMs);
  };

  const scheduleDebouncedSave = () => {
    scheduleSave(STRUCTURAL_SAVE_DEBOUNCE_MS);
  };

  const schedulePositionSave = () => {
    const elapsed = Date.now() - lastSaveAt;
    scheduleSave(Math.max(0, POSITION_SAVE_THROTTLE_MS - elapsed));
  };

  scheduleStructuralSave = scheduleDebouncedSave;

  const unsubscribePlayer = usePlayerStore.subscribe((state, previous) => {
    if (
      state.playbackState !== previous.playbackState
      && (state.playbackState === 'paused' || state.playbackState === 'stopped')
    ) {
      saveNow();
      return;
    }
    if (didPlayerStructureChange(state, previous)) {
      scheduleDebouncedSave();
      return;
    }
    if (state.currentTime !== previous.currentTime) schedulePositionSave();
  });
  const unsubscribeQueue = useQueueStore.subscribe((state, previous) => {
    if (
      state.tracks !== previous.tracks
      || state.activeIndex !== previous.activeIndex
      || state.hasSnapshot !== previous.hasSnapshot
      || state.source !== previous.source
    ) {
      scheduleDebouncedSave();
    }
  });
  const appStateSubscription = AppState.addEventListener('change', (state) => {
    if (state === 'inactive' || state === 'background') {
      saveNow();
      void AstraLibraryData.flushUserSnapshot().catch(() => {});
    }
  });

  // Persist route validation and queue normalization from hydration. The
  // snapshot fallback above gives a live native queue time to populate first.
  scheduleDebouncedSave();

  return () => {
    if (scheduleStructuralSave === scheduleDebouncedSave) scheduleStructuralSave = null;
    clearSaveTimer();
    unsubscribePlayer();
    unsubscribeQueue();
    appStateSubscription.remove();
    saveNow();
  };
}

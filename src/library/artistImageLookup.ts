import * as Network from 'expo-network';
import type { DeezerArtistCandidate } from '@/types/artistImages';
import {
  AstraLibraryData,
  AstraLibraryScanner,
  type NativeArtistImageLookupTarget,
} from '../../modules/astra-library-scanner';
import { useSettingsStore } from '@/stores/settingsStore';
import { useArtistImageStore } from '@/stores/artistImageStore';
import { endServiceFor, reportServiceProgress } from '@/library/scanService';
import {
  canAutomaticallyDownloadArtistImages,
  artistImageRetryBackoff,
  groupArtistImageTargetsByName,
} from './artistImagePolicy';
import {
  DEEZER_ARTIST_IMAGES_ENABLED,
  pickAutomaticDeezerCandidate,
  searchDeezerArtists,
} from '@/services/artistImages/deezer';
import { cacheRemoteArtistImage } from '@/services/artistImages/cache';

const PAGE_SIZE = 100;
const CACHE_RETRY_MS = 30 * 60 * 1000;
// Deezer allows roughly 50 requests per 5 seconds and answers a breach with a
// 429 that parks the whole queue for six hours. Spacing requests keeps a
// full-library sweep — which is exactly what a rescan triggers — under that.
const REQUEST_SPACING_MS = 150;
// Below this, a sweep finishes in a few seconds and a notification would be
// pure noise — adding one album should not light up the shade. Larger sweeps
// take minutes and need the foreground service to survive backgrounding.
const NOTIFICATION_THRESHOLD = 25;

/**
 * Native-backed so the sweep keeps pacing itself while Astra is backgrounded.
 * `setTimeout` stops firing the moment the activity pauses (React Native drops
 * the Choreographer callback that drives timers), which stalled the sweep at the
 * first gap between artists even with the foreground service holding the process
 * open. Falls back to a JS timer if the native build predates the method.
 */
function delay(ms: number): Promise<void> {
  if (typeof AstraLibraryScanner.backgroundDelay === 'function') {
    return AstraLibraryScanner.backgroundDelay(ms);
  }
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const n = (value: number) => value.toLocaleString();

function publishSweepProgress(announced: boolean): void {
  if (!announced) return;
  const { processed, total } = useArtistImageStore.getState();
  reportServiceProgress('artistImages', {
    title: 'Finding artist images',
    text: total > 0 ? `${n(processed)} of ${n(total)} artists` : 'Looking up artists…',
    subText: null,
    current: processed,
    total,
    indeterminate: total <= 0,
  });
}

let started = false;
let running = false;
let runAgain = false;
let debounceTimer: ReturnType<typeof setTimeout> | null = null;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let activeAutomaticLookup: AbortController | null = null;

async function networkAllowsAutomaticDownloads(): Promise<boolean> {
  if (!DEEZER_ARTIST_IMAGES_ENABLED) return false;
  const settings = useSettingsStore.getState();
  if (!settings.loaded) return false;
  const network = await Network.getNetworkStateAsync();
  return canAutomaticallyDownloadArtistImages(
    settings.artistImageAutoPolicy,
    settings.artistImageDisclosureSeen,
    network
  );
}

function setRetryTimer(delayMs: number): void {
  if (retryTimer) clearTimeout(retryTimer);
  retryTimer = setTimeout(() => {
    retryTimer = null;
    scheduleArtistImageLookups();
  }, Math.min(delayMs, 24 * 60 * 60 * 1000));
}

async function persistLookup(
  targets: NativeArtistImageLookupTarget[],
  values: Parameters<typeof AstraLibraryData.recordArtistImageLookup>[3]
): Promise<void> {
  await Promise.all(
    targets.map((target) =>
      AstraLibraryData.recordArtistImageLookup(
        target.artistKey,
        target.artistName,
        target.groupingMode,
        values
      )
    )
  );
}

async function processTargetGroup(
  targets: NativeArtistImageLookupTarget[]
): Promise<'continue' | 'pause'> {
  const attemptedAt = Date.now();
  activeAutomaticLookup = new AbortController();
  const result = await searchDeezerArtists(
    targets[0].artistName,
    activeAutomaticLookup.signal
  );
  activeAutomaticLookup = null;
  if (result.status === 'transient_error') {
    if (result.code === 'cancelled') return 'pause';
    const retryAfterMs = artistImageRetryBackoff(
      result.retryAfterMs,
      targets.map((target) => target.retryCount ?? 0)
    );
    const nextRetryAt = attemptedAt + retryAfterMs;
    await persistLookup(targets, {
      status: 'transient_error',
      attemptedAt,
      nextRetryAt,
    });
    setRetryTimer(retryAfterMs);
    return 'pause';
  }

  const candidate = pickAutomaticDeezerCandidate(
    targets[0].artistName,
    result.candidates
  );
  if (!candidate) {
    await persistLookup(targets, { status: 'not_found', attemptedAt });
    return 'continue';
  }

  try {
    if (!(await networkAllowsAutomaticDownloads())) return 'pause';
    const automaticImageHash = await cacheRemoteArtistImage(candidate.imageUrl);
    if (!(await networkAllowsAutomaticDownloads())) return 'pause';
    await persistLookup(targets, {
      status: 'found',
      attemptedAt,
      automaticImageHash,
      provider: 'deezer',
      sourceId: candidate.id,
    });
    return 'continue';
  } catch {
    const retryAfterMs = artistImageRetryBackoff(
      CACHE_RETRY_MS,
      targets.map((target) => target.retryCount ?? 0)
    );
    await persistLookup(targets, {
      status: 'transient_error',
      attemptedAt,
      nextRetryAt: attemptedAt + retryAfterMs,
    });
    setRetryTimer(retryAfterMs);
    return 'pause';
  }
}

async function drainArtistImageQueue(): Promise<void> {
  if (running) {
    runAgain = true;
    return;
  }
  running = true;
  let started = false;
  let announced = false;
  try {
    do {
      runAgain = false;
      if (!(await networkAllowsAutomaticDownloads())) return;
      const targets = await AstraLibraryData.getPendingArtistImageLookups(
        PAGE_SIZE,
        Date.now()
      );
      if (targets.length === 0) return;

      if (!started) {
        started = true;
        // Counted once for the whole sweep: re-counting per page would shrink
        // the denominator as the queue drains and the bar would never advance.
        const { pending } = await AstraLibraryData.getArtistImageStats(
          useSettingsStore.getState().artistGroupingMode,
          Date.now()
        );
        useArtistImageStore.getState().beginSweep(pending);
        announced = pending >= NOTIFICATION_THRESHOLD;
        publishSweepProgress(announced);
      }

      let first = true;
      for (const group of groupArtistImageTargetsByName(targets)) {
        if (!(await networkAllowsAutomaticDownloads())) return;
        // Between groups only: never delays the first lookup after a change.
        if (!first) await delay(REQUEST_SPACING_MS);
        first = false;
        if ((await processTargetGroup(group)) === 'pause') return;
        // One group is one provider request, so this matches the denominator.
        useArtistImageStore.getState().advanceSweep();
        publishSweepProgress(announced);
      }
      runAgain = targets.length >= PAGE_SIZE;
    } while (runAgain);
  } finally {
    running = false;
    if (started) {
      useArtistImageStore.getState().endSweep();
      // No-op when the sweep stayed under the threshold and never claimed it.
      endServiceFor('artistImages');
    }
    if (runAgain) scheduleArtistImageLookups();
  }
}

export function scheduleArtistImageLookups(): void {
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    debounceTimer = null;
    void drainArtistImageQueue();
  }, 750);
}

export function startArtistImageLookupCoordinator(): void {
  if (started) return;
  started = true;
  AstraLibraryData.addListener('onCatalogChanged', scheduleArtistImageLookups);
  Network.addNetworkStateListener((network) => {
    const settings = useSettingsStore.getState();
    if (
      !canAutomaticallyDownloadArtistImages(
        settings.artistImageAutoPolicy,
        settings.artistImageDisclosureSeen,
        network
      )
    ) {
      activeAutomaticLookup?.abort();
    }
    scheduleArtistImageLookups();
  });
  useSettingsStore.subscribe((state, previous) => {
    if (
      state.artistImageAutoPolicy !== previous.artistImageAutoPolicy ||
      state.artistImageDisclosureSeen !== previous.artistImageDisclosureSeen ||
      state.loaded !== previous.loaded
    ) {
      void networkAllowsAutomaticDownloads().then((allowed) => {
        if (!allowed) activeAutomaticLookup?.abort();
      });
      scheduleArtistImageLookups();
    }
  });
  scheduleArtistImageLookups();
}

export async function searchArtistImageCandidates(query: string) {
  return searchDeezerArtists(query);
}

/**
 * Makes artists a provider previously had no match for eligible again, then
 * kicks the queue. Called when a scan finishes so "rescan" also re-checks the
 * artists that came back empty — `not_found` is terminal in the pending query,
 * so nothing else ever revisits them.
 */
export async function requeueMissingArtistImages(): Promise<void> {
  try {
    const cleared = await AstraLibraryData.clearArtistImageLookupFailures();
    if (cleared > 0) scheduleArtistImageLookups();
  } catch (error) {
    // A scan must never fail because the retry sweep could not be queued.
    console.warn('[artistImages] could not re-queue missing artist images', error);
  }
}

export async function selectDeezerArtistImage(
  artistKey: string,
  artistName: string,
  groupingMode: 'astra' | 'fileTags',
  candidate: DeezerArtistCandidate
): Promise<void> {
  const automaticImageHash = await cacheRemoteArtistImage(candidate.imageUrl);
  await AstraLibraryData.recordArtistImageLookup(
    artistKey,
    artistName,
    groupingMode,
    {
      status: 'found',
      automaticImageHash,
      provider: 'deezer',
      sourceId: candidate.id,
      attemptedAt: Date.now(),
      clearManual: true,
    }
  );
}

export async function selectLocalArtistImage(
  artistKey: string,
  artistName: string,
  groupingMode: 'astra' | 'fileTags',
  uri: string
): Promise<void> {
  const artworkHash = await AstraLibraryScanner.cacheArtworkFromUri(uri);
  await AstraLibraryData.setManualArtistImage(
    artistKey,
    artistName,
    groupingMode,
    artworkHash
  );
}

export async function resetLocalArtistImage(
  artistKey: string,
  artistName: string,
  groupingMode: 'astra' | 'fileTags'
): Promise<void> {
  await AstraLibraryData.clearManualArtistImage(artistKey, artistName, groupingMode);
}

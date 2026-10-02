import * as Network from 'expo-network';
import type { ArtistImageSource, DeezerArtistCandidate } from '@/types/artistImages';
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
let activeSweep: { generation: number; runAgain: boolean } | null = null;
let debounceTimer: ReturnType<typeof setTimeout> | null = null;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let activeAutomaticLookup: AbortController | null = null;
const generations: Record<ArtistImageSource, number> = { deezer: 0, manual: 0 };
let imageWrites: Promise<unknown> = Promise.resolve();

// All read/modify/write image operations share this queue. Network and image
// decoding stay outside it, so clearing never waits for an unfinished download.
function enqueueImageWrite<T>(write: () => Promise<T>): Promise<T> {
  const result = imageWrites.then(write);
  imageWrites = result.catch(() => undefined);
  return result;
}

function isCurrentGeneration(source: ArtistImageSource, generation: number): boolean {
  return generations[source] === generation &&
    useArtistImageStore.getState().clearingSource !== source;
}

function selectionGeneration(source: ArtistImageSource): number {
  if (useArtistImageStore.getState().clearingSource) {
    throw new Error('Artist images are being cleared. Please try again.');
  }
  return generations[source];
}

async function networkAllowsAutomaticDownloads(generation = generations.deezer): Promise<boolean> {
  if (!DEEZER_ARTIST_IMAGES_ENABLED) return false;
  const network = await Network.getNetworkStateAsync();
  const settings = useSettingsStore.getState();
  if (!settings.loaded || !isCurrentGeneration('deezer', generation)) return false;
  return canAutomaticallyDownloadArtistImages(
    settings.artistImageAutoPolicy,
    settings.artistImageDisclosureSeen,
    network
  );
}

function setRetryTimer(delayMs: number, generation: number): void {
  if (!isCurrentGeneration('deezer', generation)) return;
  if (retryTimer) clearTimeout(retryTimer);
  retryTimer = setTimeout(() => {
    retryTimer = null;
    scheduleArtistImageLookups();
  }, Math.min(delayMs, 24 * 60 * 60 * 1000));
}

async function persistLookup(
  targets: NativeArtistImageLookupTarget[],
  values: Parameters<typeof AstraLibraryData.recordArtistImageLookup>[3],
  generation: number,
): Promise<void> {
  await enqueueImageWrite(async () => {
    for (const target of targets) {
      if (!isCurrentGeneration('deezer', generation)) return;
      await AstraLibraryData.recordArtistImageLookup(
        target.artistKey,
        target.artistName,
        target.groupingMode,
        values
      );
    }
  });
}

async function processTargetGroup(
  targets: NativeArtistImageLookupTarget[],
  generation: number,
): Promise<'continue' | 'pause'> {
  if (!isCurrentGeneration('deezer', generation)) return 'pause';
  const attemptedAt = Date.now();
  const controller = new AbortController();
  activeAutomaticLookup = controller;
  const result = await searchDeezerArtists(
    targets[0].artistName,
    controller.signal
  );
  if (activeAutomaticLookup === controller) activeAutomaticLookup = null;
  if (!isCurrentGeneration('deezer', generation)) return 'pause';
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
    }, generation);
    setRetryTimer(retryAfterMs, generation);
    return 'pause';
  }

  const candidate = pickAutomaticDeezerCandidate(
    targets[0].artistName,
    result.candidates
  );
  if (!candidate) {
    await persistLookup(targets, { status: 'not_found', attemptedAt }, generation);
    return 'continue';
  }

  try {
    if (!(await networkAllowsAutomaticDownloads(generation))) return 'pause';
    const automaticImageHash = await cacheRemoteArtistImage(candidate.imageUrl);
    if (!(await networkAllowsAutomaticDownloads(generation))) return 'pause';
    await persistLookup(targets, {
      status: 'found',
      attemptedAt,
      automaticImageHash,
      provider: 'deezer',
      sourceId: candidate.id,
    }, generation);
    return 'continue';
  } catch {
    if (!isCurrentGeneration('deezer', generation)) return 'pause';
    const retryAfterMs = artistImageRetryBackoff(
      CACHE_RETRY_MS,
      targets.map((target) => target.retryCount ?? 0)
    );
    await persistLookup(targets, {
      status: 'transient_error',
      attemptedAt,
      nextRetryAt: attemptedAt + retryAfterMs,
    }, generation);
    setRetryTimer(retryAfterMs, generation);
    return 'pause';
  }
}

async function drainArtistImageQueue(): Promise<void> {
  if (!isCurrentGeneration('deezer', generations.deezer)) return;
  if (activeSweep) {
    activeSweep.runAgain = true;
    return;
  }
  const sweep = { generation: generations.deezer, runAgain: false };
  activeSweep = sweep;
  let started = false;
  let announced = false;
  try {
    do {
      sweep.runAgain = false;
      if (!(await networkAllowsAutomaticDownloads(sweep.generation))) return;
      const targets = await AstraLibraryData.getPendingArtistImageLookups(
        PAGE_SIZE,
        Date.now()
      );
      if (targets.length === 0 || activeSweep !== sweep) return;

      if (!started) {
        started = true;
        // Counted once for the whole sweep: re-counting per page would shrink
        // the denominator as the queue drains and the bar would never advance.
        const { pending } = await AstraLibraryData.getArtistImageStats(
          useSettingsStore.getState().artistGroupingMode,
          Date.now()
        );
        if (activeSweep !== sweep) return;
        useArtistImageStore.getState().beginSweep(pending);
        announced = pending >= NOTIFICATION_THRESHOLD;
        publishSweepProgress(announced);
      }

      let first = true;
      for (const group of groupArtistImageTargetsByName(targets)) {
        if (!(await networkAllowsAutomaticDownloads(sweep.generation))) return;
        // Between groups only: never delays the first lookup after a change.
        if (!first) await delay(REQUEST_SPACING_MS);
        first = false;
        if ((await processTargetGroup(group, sweep.generation)) === 'pause') return;
        if (activeSweep !== sweep) return;
        // One group is one provider request, so this matches the denominator.
        useArtistImageStore.getState().advanceSweep();
        publishSweepProgress(announced);
      }
      sweep.runAgain = targets.length >= PAGE_SIZE;
    } while (sweep.runAgain);
  } finally {
    // A cleared sweep may finish after its replacement has started.
    if (activeSweep === sweep) {
      activeSweep = null;
      if (started) {
        useArtistImageStore.getState().endSweep();
        endServiceFor('artistImages');
      }
      if (sweep.runAgain) scheduleArtistImageLookups();
    }
  }
}

export function scheduleArtistImageLookups(): void {
  if (!isCurrentGeneration('deezer', generations.deezer)) return;
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    debounceTimer = null;
    void drainArtistImageQueue().catch((error) => {
      console.warn('[artistImages] could not finish image sweep', error);
    });
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
  const generation = generations.deezer;
  try {
    const cleared = await enqueueImageWrite(async () =>
      isCurrentGeneration('deezer', generation)
        ? AstraLibraryData.clearArtistImageLookupFailures()
        : 0
    );
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
  const generation = selectionGeneration('deezer');
  const automaticImageHash = await cacheRemoteArtistImage(candidate.imageUrl);
  await enqueueImageWrite(async () => {
    if (!isCurrentGeneration('deezer', generation)) return;
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
  });
}

export async function selectLocalArtistImage(
  artistKey: string,
  artistName: string,
  groupingMode: 'astra' | 'fileTags',
  uri: string
): Promise<void> {
  const generation = selectionGeneration('manual');
  const artworkHash = await AstraLibraryScanner.cacheArtworkFromUri(uri);
  await enqueueImageWrite(async () => {
    if (!isCurrentGeneration('manual', generation)) return;
    await AstraLibraryData.setManualArtistImage(
      artistKey, artistName, groupingMode, artworkHash
    );
  });
}

export async function resetLocalArtistImage(
  artistKey: string,
  artistName: string,
  groupingMode: 'astra' | 'fileTags'
): Promise<void> {
  const generation = selectionGeneration('manual');
  await enqueueImageWrite(async () => {
    if (!isCurrentGeneration('manual', generation)) return;
    await AstraLibraryData.clearManualArtistImage(artistKey, artistName, groupingMode);
  });
}

export async function clearArtistImages(source: ArtistImageSource): Promise<void> {
  if (useArtistImageStore.getState().clearingSource) {
    throw new Error('Artist images are already being cleared.');
  }
  generations[source] += 1;
  useArtistImageStore.setState({ clearingSource: source });
  if (source === 'deezer') {
    if (debounceTimer) clearTimeout(debounceTimer);
    if (retryTimer) clearTimeout(retryTimer);
    debounceTimer = retryTimer = null;
    activeAutomaticLookup?.abort();
    activeAutomaticLookup = null;
    activeSweep = null;
    useArtistImageStore.getState().endSweep();
    endServiceFor('artistImages');
  }
  try {
    await enqueueImageWrite(() => AstraLibraryData.clearArtistImages(source));
    if (source === 'deezer') {
      // Native commits this setting atomically with the image clear.
      useSettingsStore.setState({ artistImageAutoPolicy: 'off' });
    }
    await useArtistImageStore.getState().refreshMissing();
  } finally {
    useArtistImageStore.setState({ clearingSource: null });
    // On failure the policy is unchanged; eligible work can restart. Custom
    // clearing also leaves the automatic policy and current sweep intact.
    if (useSettingsStore.getState().artistImageAutoPolicy !== 'off') {
      scheduleArtistImageLookups();
    }
  }
}

// Whole-queue normalization gain registry. Registers every queued track's resolved
// gain natively by URL (one batched DB read + one bridge call), so the player finds
// the right gain at ANY media-item transition — skips beyond the prefetch window,
// fresh queues, headless starts — with no JS in the loop. Also maintains the native
// fallback ("temp") gain used when a transition hits a track with no facts yet:
// deliberately a touch quiet (Poweramp-style), so the late correction is a small
// upward glide instead of a loud burst then a duck.
//
// The play path only does lookups, never work: analysis/decoding stays in
// useNormalizationSync's prefetch + ensureTrackLoudness (fire-and-forget).
//
// IMPORTANT (queueLoader): this module reads ONLY the JS queue mirror
// (useQueueStore.tracks) and makes ZERO TrackPlayer.* calls, so it needs no
// queueLoader settle-gating — the mirror holds the full playback context from
// setSnapshot before the chunked native load even starts. Keep it that way.
//
// Not a hook — started idempotently from both the UI (useNormalizationSync) and the
// headless PlaybackService, so Android Auto / Bluetooth starts are covered with the
// app UI never mounted.

import { useQueueStore } from '@/stores/queueStore';
import { useAudioSettingsStore } from '@/stores/audioSettingsStore';
import { openLibraryDb } from '@/db/database';
import {
  getLibraryLoudnessStats,
  getSetting,
  getTrackLoudnessByPaths,
  setSetting,
} from '@/db/queries';
import {
  dbToLinear,
  hasUsableReplayGain,
  resolveFallbackGain,
  resolveNormalizationGain,
} from '@/audio/normalization';
import { factsFromRow } from '@/audio/trackAnalysis';
import { setFallbackGainNative, setTrackGainsNative } from '@/audio/eqNative';

/** Persisted fallback gain (dB) — pushed before the stats aggregate on cold start. */
const FALLBACK_DB_KEY = 'normalization_fallback_db';

/** Single-setting cold-start read; no library aggregate or track analysis. */
export async function loadPersistedFallbackGain(): Promise<number | null> {
  const db = await openLibraryDb();
  const raw = await getSetting(db, FALLBACK_DB_KEY);
  if (raw === null) return null;
  const gainDb = Number(raw);
  if (!Number.isFinite(gainDb)) return null;
  const linear = dbToLinear(gainDb);
  return Number.isFinite(linear) && linear > 0 ? linear : null;
}

/**
 * The queue can change rapidly (drag-reorder); coalesce re-registrations. Kept
 * past the start-of-playback transition: registering a large queue marshals a
 * big IN() query + one large JSI map, and nothing needs it that early — the
 * current track's gain is activated explicitly and the next few are prefetched;
 * the whole-queue map only matters for far jumps (fallback covers the gap).
 */
const REGISTER_DEBOUNCE_MS = 500;

let started = false;
let generation = 0;
let debounceTimer: ReturnType<typeof setTimeout> | null = null;
let fallbackDirty = false;

/** Idempotent; safe to call from both the UI hook and the headless service. */
export function ensureGainRegistryStarted(): void {
  if (started) return;
  started = true;

  useQueueStore.subscribe((state, prev) => {
    // Identity change covers set/reorder/add/remove; activeIndex-only changes are
    // irrelevant — the native map is URL-keyed, not position-keyed.
    if (state.tracks !== prev.tracks) scheduleRegister(false);
  });
  useAudioSettingsStore.subscribe((state, prev) => {
    if (
      state.normalizationEnabled !== prev.normalizationEnabled ||
      state.normalizationTargetLufs !== prev.normalizationTargetLufs ||
      state.replayGainEnabled !== prev.replayGainEnabled ||
      state.replayGainMode !== prev.replayGainMode
    ) {
      scheduleRegister(true);
    }
  });

  // Cover app relaunch with a persisted queue and headless service start.
  void refreshFallbackGain().catch(() => {});
  void registerQueueGains().catch(() => {});
}

function scheduleRegister(refreshFallback: boolean): void {
  // Settings changes (e.g. dragging the target-LUFS slider) can fire per tick; the
  // stats aggregate + whole-queue recompute ride the same debounce.
  if (refreshFallback) fallbackDirty = true;
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    debounceTimer = null;
    const doFallback = fallbackDirty;
    fallbackDirty = false;
    void (async () => {
      if (doFallback) await refreshFallbackGain().catch(() => {});
      await registerQueueGains().catch(() => {});
    })();
  }, REGISTER_DEBOUNCE_MS);
}

async function registerQueueGains(): Promise<void> {
  const gen = ++generation;
  await useAudioSettingsStore.getState().load();
  const settings = useAudioSettingsStore.getState().asNormalizationSettings();
  const tracks = useQueueStore.getState().tracks;

  const entries: Record<string, number> = {};
  const localUrls: string[] = [];
  const seen = new Set<string>();
  for (const track of tracks) {
    const url = typeof track.url === 'string' ? track.url : null;
    if (!url || url.length === 0 || seen.has(url)) continue;
    seen.add(url);
    const sourceType = typeof track.sourceType === 'string' ? track.sourceType : undefined;
    if (sourceType && sourceType !== 'local') {
      // Remote tracks key by their resolved stream URL and have no local facts:
      // explicit unity so a map miss never applies the fallback attenuation.
      entries[url] = 1;
    } else if (!settings.enabled) {
      entries[url] = 1;
    } else {
      localUrls.push(url); // local url === tracks.path (the DB key)
    }
  }

  if (settings.enabled && localUrls.length > 0) {
    const db = await openLibraryDb();
    const rows = await getTrackLoudnessByPaths(db, localUrls);
    if (gen !== generation) return; // a newer registration superseded this one
    for (const url of localUrls) {
      const row = rows.get(url);
      if (!row) continue; // not in the library — leave unregistered (fallback)
      const facts = factsFromRow(row);
      if (facts.loudnessLufs != null || hasUsableReplayGain(facts, settings)) {
        entries[url] = resolveNormalizationGain(facts, settings).linearGain;
      }
      // No usable facts yet: deliberately NOT registered, so the transition
      // activates the fallback gain. (resolveNormalizationGain returns unity for
      // fact-less tracks — registering that would reintroduce the loud burst.)
    }
  }

  if (gen !== generation) return;
  // One bridge call; clearing bounds the native map to the live queue and drops
  // entries computed under old settings.
  setTrackGainsNative(entries, true);
}

/**
 * Compute + push the native fallback gain from library-wide loudness stats.
 * Pinned to unity while normalization is off (that keeps map misses at full
 * volume with the feature disabled).
 */
async function refreshFallbackGain(): Promise<void> {
  await useAudioSettingsStore.getState().load();
  const settings = useAudioSettingsStore.getState().asNormalizationSettings();
  if (!settings.enabled) {
    setFallbackGainNative(1);
    return;
  }

  const db = await openLibraryDb();

  // Push the last persisted value first — closes the cold-start window where a
  // headless (Android Auto) start could hit a transition before the aggregate lands.
  const persistedRaw = await getSetting(db, FALLBACK_DB_KEY).catch(() => null);
  const persistedDb = persistedRaw === null ? NaN : Number(persistedRaw);
  if (Number.isFinite(persistedDb)) setFallbackGainNative(dbToLinear(persistedDb));

  const stats = await getLibraryLoudnessStats(db);
  const resolved = resolveFallbackGain(stats, settings);
  setFallbackGainNative(resolved.linearGain);
  await setSetting(db, FALLBACK_DB_KEY, String(resolved.gainDb)).catch(() => {});
}

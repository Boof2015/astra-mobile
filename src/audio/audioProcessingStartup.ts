import TrackPlayer, { type Track as RntpTrack } from 'react-native-track-player';
import { DspStartupCoordinator, type DspWarmupInputs } from './dspStartupCoordinator';
import { useAudioSettingsStore } from '@/stores/audioSettingsStore';
import { useEQStore } from '@/stores/eqStore';
import { openLibraryDb } from '@/db/database';
import { getTrackLoudnessByPaths } from '@/db/queries';
import { factsFromRow } from '@/audio/trackAnalysis';
import type { NormalizationSettings } from '@/audio/normalization';
import {
  resolveFastStartupFallback,
  resolveStartupTargetGain,
  type StartupTargetGain,
} from '@/audio/dspStartupGain';
import {
  applyEqNativeStrict,
  assertNativeDspAvailable,
  primeTrackGainNativeStrict,
  setFallbackGainNativeStrict,
  setTrackGainNativeStrict,
} from '@/audio/eqNative';
import {
  dbToLinear as eqDbToLinear,
  flattenBandsForNative,
} from '@/audio/eq';
import { buildGraphicBands } from '@/audio/graphicEq';
import { refreshEQRouteForPlayback } from '@/audio/eqRouteSync';
import {
  ensureGainRegistryStarted,
  loadPersistedFallbackGain,
} from '@/audio/gainRegistry';
import type { AudioOutputRoute } from '@/types/audio';

export type DspTargetActivation = 'none' | 'immediate';

export interface DspPlaybackTarget {
  url: string | null;
  sourceType?: string | null;
  activation: DspTargetActivation;
}

type WarmupInputs = DspWarmupInputs<NormalizationSettings, AudioOutputRoute, number | null>;

const ROUTE_FRESH_MS = 500;

function strictSyncCurrentEq(): void {
  const state = useEQStore.getState();
  const bands = state.mode === 'graphic' ? buildGraphicBands(state.graphicGains) : state.bands;
  applyEqNativeStrict(
    state.enabled,
    state.enabled ? eqDbToLinear(state.preamp) : 1,
    flattenBandsForNative(bands),
  );
}

async function resolveTargetGain(
  target: DspPlaybackTarget,
  settings: NormalizationSettings,
  fallback: number,
): Promise<StartupTargetGain> {
  if (!target.url) return resolveStartupTargetGain('none', null, settings, fallback);
  if (!settings.enabled) return resolveStartupTargetGain('local', null, settings, fallback);
  if (target.sourceType && target.sourceType !== 'local') {
    return resolveStartupTargetGain('remote', null, settings, fallback);
  }

  const db = await openLibraryDb();
  const rows = await getTrackLoudnessByPaths(db, [target.url]);
  const facts = factsFromRow(rows.get(target.url) ?? null);
  return resolveStartupTargetGain('local', facts, settings, fallback);
}

function settingsSnapshot(): NormalizationSettings {
  return useAudioSettingsStore.getState().asNormalizationSettings();
}

function timingLog(
  stage: 'base' | 'target',
  reason: string,
  status: 'ready' | 'failed',
  elapsedMs: number,
): void {
  const entry = { at: Date.now(), stage, reason, status, elapsedMs };
  if (status === 'failed') console.warn('[dsp-startup] stage', entry);
  else console.info('[dsp-startup] stage', entry);
}

const coordinator = new DspStartupCoordinator<
  NormalizationSettings,
  AudioOutputRoute,
  number | null,
  DspPlaybackTarget
>({
  loadSettings: async () => {
    await useAudioSettingsStore.getState().load();
    return settingsSnapshot();
  },
  loadEqRoute: refreshEQRouteForPlayback,
  loadPersistedFallback: loadPersistedFallbackGain,
  applyBase: ({ settings, route, persistedFallback }) => {
    assertNativeDspAvailable();
    strictSyncCurrentEq();
    const fallback = resolveFastStartupFallback(settings, persistedFallback);
    setFallbackGainNativeStrict(fallback);
    const eq = useEQStore.getState();
    console.info('[dsp-startup] base-applied', {
      at: Date.now(),
      routeKey: route.key,
      routeKind: route.kind,
      nativeType: route.nativeType,
      eqEnabled: eq.enabled,
      preampDb: eq.preamp,
      normalizationEnabled: settings.enabled,
      fallbackLinear: fallback,
    });
  },
  prepareTarget: async (inputs, target) => {
    const fallback = resolveFastStartupFallback(inputs.settings, inputs.persistedFallback);
    const routePromise =
      Date.now() - inputs.route.updatedAt <= ROUTE_FRESH_MS
        ? Promise.resolve(inputs.route)
        : refreshEQRouteForPlayback();
    const [route, resolved] = await Promise.all([
      routePromise,
      resolveTargetGain(target, inputs.settings, fallback),
    ]);

    // Route listeners normally keep this current. Reassert synchronously here
    // so their defensive/no-op wrappers cannot release a guarded play command.
    assertNativeDspAvailable();
    strictSyncCurrentEq();
    setFallbackGainNativeStrict(fallback);
    if (target.url) {
      setTrackGainNativeStrict(target.url, resolved.linearGain);
      if (target.activation === 'immediate') primeTrackGainNativeStrict(target.url);
    }
    console.info('[dsp-startup] target-applied', {
      at: Date.now(),
      routeKey: route.key,
      routeKind: route.kind,
      nativeType: route.nativeType,
      gainSource: resolved.source,
      activation: target.activation,
      hasTarget: Boolean(target.url),
    });
  },
  onTiming: ({ stage, reason, status, elapsedMs }) => {
    timingLog(stage, reason, status, elapsedMs);
  },
});

let monitoringStarted = false;

function ensureStartupMonitoring(): void {
  if (monitoringStarted) return;
  monitoringStarted = true;
  useAudioSettingsStore.subscribe((state, previous) => {
    if (
      state.normalizationEnabled !== previous.normalizationEnabled ||
      state.normalizationTargetLufs !== previous.normalizationTargetLufs ||
      state.replayGainEnabled !== previous.replayGainEnabled ||
      state.replayGainMode !== previous.replayGainMode
    ) {
      void coordinator.rewarm('normalization-settings-change').catch((error) => {
        console.warn('[dsp-startup] eager settings warm failed', {
          at: Date.now(),
          error: error instanceof Error ? error.name : 'UnknownError',
        });
      });
    }
  });
}

function startBackgroundGainWork(): void {
  // Idempotent and intentionally launched only after the safety state is ready.
  // Its library aggregate, analysis, and whole-queue map are not play blockers.
  ensureGainRegistryStarted();
}

export function startAudioProcessingWarmup(reason: string): Promise<WarmupInputs> {
  ensureStartupMonitoring();
  const warmup = coordinator.warm(reason);
  void warmup.then(startBackgroundGainWork, () => {});
  return warmup;
}

export async function prepareAudioProcessingForPlayback(
  target: DspPlaybackTarget,
  reason: string,
): Promise<void> {
  ensureStartupMonitoring();
  try {
    await coordinator.prepare(target, reason);
    startBackgroundGainWork();
  } catch (error) {
    // Fail closed. Do not let an unavailable DB/route/native bridge turn into a
    // unity-gain burst; the next explicit command retries through the coordinator.
    await TrackPlayer.pause().catch(() => {});
    console.warn('[dsp-startup] playback held paused', {
      at: Date.now(),
      reason,
      error: error instanceof Error ? error.name : 'UnknownError',
    });
    throw error;
  }
}

/** Re-prime an already registered target after a paused queue transition. */
export async function primePreparedTrackForPlayback(
  target: DspPlaybackTarget,
  reason: string,
): Promise<void> {
  if (!target.url) return;
  try {
    assertNativeDspAvailable();
    primeTrackGainNativeStrict(target.url);
  } catch (error) {
    await TrackPlayer.pause().catch(() => {});
    console.warn('[dsp-startup] target prime held paused', {
      at: Date.now(),
      reason,
      error: error instanceof Error ? error.name : 'UnknownError',
    });
    throw error;
  }
}

export function dspTargetFromTrack(
  track: RntpTrack | null | undefined,
  activation: DspTargetActivation,
): DspPlaybackTarget {
  return {
    url: typeof track?.url === 'string' && track.url.length > 0 ? track.url : null,
    sourceType: typeof track?.sourceType === 'string' ? track.sourceType : null,
    activation,
  };
}

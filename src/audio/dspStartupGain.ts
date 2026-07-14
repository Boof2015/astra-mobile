import {
  FALLBACK_CEILING_DB,
  NORM_MIN_GAIN_DB,
  dbToLinear,
  hasUsableReplayGain,
  resolveFallbackGain,
  resolveNormalizationGain,
  type LoudnessFacts,
  type NormalizationSettings,
} from './normalization.ts';

export interface StartupTargetGain {
  linearGain: number;
  source: 'none' | 'disabled' | 'remote' | 'stored' | 'fallback';
}

const EMPTY_STATS = {
  lufsCount: 0,
  medianLufs: null,
  rgCount: 0,
  medianRgTrackDb: null,
};

export function resolveFastStartupFallback(
  settings: NormalizationSettings,
  persisted: number | null,
): number {
  if (!settings.enabled) return 1;

  if (persisted != null && Number.isFinite(persisted) && persisted > 0) {
    const quietest = dbToLinear(NORM_MIN_GAIN_DB);
    const loudest = dbToLinear(FALLBACK_CEILING_DB);
    return Math.max(quietest, Math.min(loudest, persisted));
  }

  return resolveFallbackGain(EMPTY_STATS, settings).linearGain;
}

export function resolveStartupTargetGain(
  kind: 'none' | 'remote' | 'local',
  facts: LoudnessFacts | null,
  settings: NormalizationSettings,
  fallback: number,
): StartupTargetGain {
  if (kind === 'none') return { linearGain: 1, source: 'none' };
  if (!settings.enabled) return { linearGain: 1, source: 'disabled' };
  if (kind === 'remote') return { linearGain: 1, source: 'remote' };
  if (facts && (facts.loudnessLufs != null || hasUsableReplayGain(facts, settings))) {
    return {
      linearGain: resolveNormalizationGain(facts, settings).linearGain,
      source: 'stored',
    };
  }
  return { linearGain: fallback, source: 'fallback' };
}

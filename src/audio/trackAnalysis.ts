// Per-track normalization facts: ReplayGain tags (cheap, container-only) + measured
// integrated LUFS / sample peak (a decode, only when ReplayGain can't cover the track).
//
// ensureTrackLoudness is the single deduped entry point used by the normalization sync
// (current track + queue prefetch). It reads ReplayGain tags once per track, and only
// falls back to the expensive loudness decode when ReplayGain is off or absent — so a
// fully tagged library normalizes with no decoding at all.

import {
  AstraLibraryData,
  AstraLibraryScanner,
  type NativeTrackLoudness,
} from '../../modules/astra-library-scanner';
import { hasUsableReplayGain, type LoudnessFacts } from '@/audio/normalization';
import { useAudioSettingsStore } from '@/stores/audioSettingsStore';

/** Map a loudness DB row (or a miss) to the resolver's facts shape. */
export function factsFromRow(row: NativeTrackLoudness | null): LoudnessFacts {
  return {
    loudnessLufs: row?.loudness_lufs ?? null,
    samplePeak: row?.sample_peak ?? null,
    replayGainTrackDb: row?.replay_gain_track_db ?? null,
    replayGainAlbumDb: row?.replay_gain_album_db ?? null,
    replayGainTrackPeak: row?.replay_gain_track_peak ?? null,
    replayGainAlbumPeak: row?.replay_gain_album_peak ?? null,
  };
}

/**
 * Measure + store integrated loudness + sample peak for one track (always
 * re-measures). The decode is the expensive part; failures leave loudness NULL.
 */
export async function measureAndStoreLoudness(
  path: string
): Promise<{ lufs: number | null; peak: number | null }> {
  try {
    const res = await AstraLibraryScanner.measureLoudness(path);
    const lufs = res?.lufs ?? null;
    const peak = res?.peak ?? null;
    await AstraLibraryData.setTrackLoudness(path, lufs, peak).catch(() => {});
    return { lufs, peak };
  } catch {
    return { lufs: null, peak: null };
  }
}

const inflight = new Map<string, Promise<LoudnessFacts>>();

/**
 * Loudness facts for a track, reading ReplayGain tags and decoding only as needed
 * (deduped by path). Cheap when already analyzed (single DB read). The normalization
 * sync uses this so tracks from a pre-M4 library still normalize before a full rescan.
 */
export function ensureTrackLoudness(path: string): Promise<LoudnessFacts> {
  const existing = inflight.get(path);
  if (existing) return existing;
  const task = run(path).finally(() => inflight.delete(path));
  inflight.set(path, task);
  return task;
}

async function run(path: string): Promise<LoudnessFacts> {
  const row = (await AstraLibraryData.getTrackLoudness([path]))[0] ?? null;
  let facts = factsFromRow(row);

  // 1. Read ReplayGain tags once per track (container-only, no decode). Decoupled
  //    from loudness so a track measured before ReplayGain was enabled still picks
  //    up its tags; rg_scanned stays unset on failure so it retries next touch.
  if (!row || row.rg_scanned !== 1) {
    try {
      const rg = await AstraLibraryScanner.readReplayGain(path);
      await AstraLibraryData.setTrackReplayGain(
        path,
        rg.trackGainDb,
        rg.albumGainDb,
        rg.trackPeak,
        rg.albumPeak
      ).catch(() => {});
      facts = {
        ...facts,
        replayGainTrackDb: rg.trackGainDb,
        replayGainAlbumDb: rg.albumGainDb,
        replayGainTrackPeak: rg.trackPeak,
        replayGainAlbumPeak: rg.albumPeak,
      };
    } catch {
      /* tag read failed — fall through to a loudness measure */
    }
  }

  // 2. Loudness already measured — nothing more to do.
  if (facts.loudnessLufs != null) return facts;

  // 3. ReplayGain alone can normalize this track — skip the expensive decode.
  const settings = useAudioSettingsStore.getState().asNormalizationSettings();
  if (hasUsableReplayGain(facts, settings)) return facts;

  // 4. Otherwise measure loudness now (decode) and merge it in.
  const measured = await measureAndStoreLoudness(path);
  return { ...facts, loudnessLufs: measured.lufs, samplePeak: measured.peak };
}

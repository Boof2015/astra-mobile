import test from 'node:test';
import assert from 'node:assert/strict';
import { createAnalysisRunner, cancelledAnalysisResult, type AnalysisDependencies } from './trackAnalysisRunner.ts';
import { AnalysisCoordinator } from './analysisCoordinator.ts';
import { CacheInvalidationGate } from '../lib/cacheInvalidation.ts';
import type { TrackAnalysis } from '../../modules/astra-library-scanner/index.ts';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => { resolve = yes; });
  return { promise, resolve };
}
const tick = () => new Promise<void>((resolve) => setImmediate(resolve));
function analysis(overrides: Partial<TrackAnalysis> = {}): TrackAnalysis {
  return {
    completed: true, cancelled: false, decoderRoute: 'native', fallbackReason: null,
    peaks: new Array(512).fill(.5), lufs: -14, peak: .9, withLoudness: true,
    decodeMs: 100, durationMs: 180000, realtimeFactor: 1800, decoderName: 'test', mime: 'audio/flac',
    queueWaitMs: 0, setupMs: 1, firstPcmMs: 2, firstProgressMs: 3, decodeToEosMs: 95,
    finalizeMs: 1, cleanupMs: 1, endToEndMs: 100, sampleRate: 48000, channelCount: 2,
    ...overrides,
  };
}
function fixture() {
  const decoded: { loudness: boolean; attemptId: string }[] = [];
  const writes: string[] = [];
  const cancelled: string[] = [];
  const gate = new CacheInvalidationGate();
  const settings = { enabled: true, replayGainEnabled: false, replayGainMode: 'auto' as const, targetLufs: -12 };
  const deps: AnalysisDependencies = {
    cacheGate: gate, getSettings: () => settings, recordTiming: () => {},
    data: {
      getWaveform: async () => null,
      getTrackLoudness: async () => [],
      getTrack: async <T>() => ({ duration: 180 } as T),
      setTrackReplayGain: async () => { writes.push('replaygain'); },
      setTrackLoudness: async () => { writes.push('loudness'); },
      putWaveform: async () => { writes.push('peaks'); },
    },
    scanner: {
      readReplayGain: async () => { throw new Error('ReplayGain disabled: should not read'); },
      analyzeTrack: async (_path, _bins, loudness, attemptId) => {
        decoded.push({ loudness, attemptId }); return analysis({ withLoudness: loudness });
      },
      cancelAnalysis: async (id) => { cancelled.push(id); },
    },
  };
  const queue = new AnalysisCoordinator(createAnalysisRunner(deps), cancelledAnalysisResult);
  return { deps, queue, settings, decoded, writes, cancelled, gate };
}
const waveform = { peaks: true, priority: 'interactive' as const };

test('normalization-off prefetch generates only waveform data', async () => {
  const f = fixture(); f.settings.enabled = false;
  const result = await f.queue.request('a', { ...waveform, priority: 'prefetch' });
  assert.equal(result.peaks?.length, 512);
  assert.deepEqual(f.decoded.map((d) => d.loudness), [false]);
  assert.deepEqual(f.writes, ['peaks']);
});

test('foreground waveform and headless loudness share one decode and both cache writes', async () => {
  const f = fixture();
  const first = f.queue.request('a', { ...waveform, peaks: false });
  const second = f.queue.request('a', waveform);
  assert.equal(first, second);
  await second;
  assert.equal(f.decoded.length, 1);
  assert.equal(f.decoded[0].loudness, true);
  assert.deepEqual(f.writes, ['peaks', 'loudness']);
});

test('headless playback with normalization disabled does not decode merely for peaks', async () => {
  const f = fixture(); f.settings.enabled = false;
  await f.queue.request('a', { ...waveform, peaks: false });
  assert.equal(f.decoded.length, 0); assert.deepEqual(f.writes, []);
});

test('cancellation while cache lookup is pending never starts native decoding', async () => {
  const f = fixture(); const lookup = deferred<number[] | null>();
  f.deps.data.getWaveform = () => lookup.promise;
  const pending = f.queue.request('a', waveform); await tick();
  f.queue.setCurrentPath('b'); lookup.resolve(null);
  assert.equal((await pending).cancelled, true);
  assert.equal(f.decoded.length, 0); assert.deepEqual(f.writes, []);
});

test('native failure and cancellation cannot write either cache even if peaks are present', async () => {
  for (const result of [
    analysis({ completed: false }), analysis({ cancelled: true }),
    analysis({ peaks: [1] }), analysis({ peaks: new Array(512).fill(NaN) }),
  ]) {
    const f = fixture(); f.deps.scanner.analyzeTrack = async () => result;
    assert.equal((await f.queue.request('a', waveform)).peaks, null);
    assert.deepEqual(f.writes, []);
  }
});

test('clearing caches during native analysis invalidates its result before persistence', async () => {
  const f = fixture(); const native = deferred<TrackAnalysis>();
  f.deps.scanner.analyzeTrack = () => native.promise;
  const pending = f.queue.request('a', waveform); await tick();
  f.queue.cancelAll(); await f.gate.invalidate(async () => { f.writes.push('clear'); });
  native.resolve(analysis());
  assert.equal((await pending).cancelled, true);
  assert.deepEqual(f.writes, ['clear']); assert.equal(f.cancelled.length, 1);
});

test('generation invalidation alone also rejects a late native result', async () => {
  const f = fixture(); const native = deferred<TrackAnalysis>();
  f.deps.scanner.analyzeTrack = () => native.promise;
  const pending = f.queue.request('a', waveform); await tick();
  await f.gate.invalidate(async () => {}); native.resolve(analysis());
  await pending; assert.deepEqual(f.writes, []);
});

test('cached waveform returns without native work when normalization is disabled', async () => {
  const f = fixture(); f.settings.enabled = false;
  f.deps.data.getWaveform = async () => new Array(512).fill(.25);
  const result = await f.queue.request('a', waveform);
  assert.equal(result.peaks?.[0], .25); assert.equal(f.decoded.length, 0);
});
